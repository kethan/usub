import { beforeEach, describe, expect, it } from "vitest";
import { api, sub } from "../src/index.js";
import { api as liteApi, sub as liteSub } from "../lite/index.js";
import { api as tinyApi, sub as tinySub } from "../tiny/index.js";
import { createApiResetter, gc, tick, time } from "./helpers.js";

const resetAllApis = createApiResetter(api, liteApi, tinyApi);

function effectOwnedSubs(subImpl, apiObj) {
	const runners = new Set();
	apiObj.effect = (f) => {
		const runner = () => f();
		runners.add(runner);
		runner();
		return () => {
			runners.delete(runner);
		};
	};
	apiObj.is = (v) => Boolean(v && v.peek !== undefined);
	apiObj.get = (v) => v.value;
	apiObj.cleanup = undefined;
	apiObj.any = undefined;

	const refs = [];
	for (let i = 0; i < 20; i++) {
		const target = { value: 1, peek: 1 };
		const payload = { n: i };
		const off = subImpl(target, () => payload);
		refs.push(new WeakRef(target), new WeakRef(payload));
		off();
	}
	return refs;
}

describe("core subscriptions & finalization", () => {
	beforeEach(() => {
		resetAllApis();
	});

	it("Promise: next", async () => {
		const arr = [];
		const p = new Promise((ok) => setTimeout(() => ok(1), 5));
		sub(p, (v) => arr.push(v), (e) => arr.push(e), () => arr.push("end"));

		expect(arr).toEqual([]);
		await time(25);
		expect(arr).toEqual([1, "end"]);
	});

	it("Promise: error", async () => {
		const arr = [];
		const p = new Promise((_ok, err) => setTimeout(() => err(new Error("xyz")), 5));
		sub(p, null, (err) => arr.push(err.message), (done) => arr.push(done));

		expect(arr).toEqual([]);
		await time(25);
		expect(arr).toEqual(["xyz"]);
	});

	it("rxjs Subject", async () => {
		const arr = [];
		const { Subject } = await import("rxjs");
		const subject = new Subject();

		const unsub = sub(subject, (v) => arr.push(v), (err) => arr.push(err), () => arr.push("end"));

		expect(arr).toEqual([]);
		subject.next(1);
		expect(arr).toEqual([1]);
		subject.next(2);
		expect(arr).toEqual([1, 2]);

		subject.complete();
		expect(arr).toEqual([1, 2, "end"]);

		unsub();
	});

	it("observ", async () => {
		const arr = [];
		const { default: Observable } = await import("observ");

		const v = Observable(1);
		sub(v, (val) => arr.push(val));
		expect(arr).toEqual([]);
		v.set(2);
		expect(arr).toEqual([2]);
	});

	it("observable", async () => {
		const arr = [];
		const { default: Observable } = await import("observable");

		const v = Observable(1);
		sub(v, (val) => arr.push(val));
		expect(arr).toEqual([1]);
		v(2);
		expect(arr).toEqual([1, 2]);
	});

	it("asyncIterable", async () => {
		const arr = [];
		const asyncIterable = {
			[Symbol.asyncIterator]() {
				return {
					i: 0,
					next() {
						if (this.i < 3) return Promise.resolve({ value: this.i++, done: false });
						return Promise.resolve({ done: true });
					},
				};
			},
		};

		sub(asyncIterable, (v) => arr.push(v), (err) => err, () => arr.push("end"));
		expect(arr).toEqual([]);
		await tick(4);
		expect(arr).toEqual([0, 1, 2, "end"]);
	});

	it("does not keep observer refs for mock", async () => {
		const arr = [];
		;(() => {
			const mock = {
				subscribe() {
					arr.push("sub");
					return { unsubscribe: () => arr.push("unsub") };
				},
			};
			sub(mock, (v) => arr.push(v));
		})();
		expect(arr).toEqual(["sub"]);

		await gc();
		expect(arr).toEqual(["sub", "unsub"]);
	});

	it("collecting callback does not invoke unsubscribe", async () => {
		const arr = [];
		const mock = {
			subscribe() {
				arr.push("sub");
				return { unsubscribe: () => arr.push("unsub") };
			},
		};
		let cb = (v) => arr.push(v);
		const unsub = sub(mock, cb);
		expect(arr).toEqual(["sub"]);

		cb = null;
		await gc();
		expect(arr).toEqual(["sub"]);
		unsub();
	});

	it("does not keep observer refs for Preact signal", async () => {
		const { signal } = await import("@preact/signals-core");

		const arr = [];
		let s1 = signal(0);
		const unsub = sub(s1, (v) => arr.push(v), null, () => arr.push("end"));

		expect(arr).toEqual([0]);
		await gc();
		expect(arr).toEqual([0]);

		s1.value = 1;
		await tick();
		expect(arr).toEqual([0, 1]);

		unsub();
		s1 = null;
		await gc();
		expect(arr).toEqual([0, 1, "end"]);
	});

	it("solid.js", async () => {
		const { createSignal, createEffect, onCleanup, createRoot } = await import("solid-js/dist/solid.js");
		let arr = [];

		api.effect = (f) => createRoot((dispose) => (createEffect(f), dispose));
		api.is = (v) => v?.name?.includes("readSignal");
		api.get = (v) => v?.();
		api.cleanup = (fn) => fn && onCleanup(fn);

		let [val, setVal] = createSignal(0);
		const offFirst = sub(val, (v) => arr.push(v), null, () => arr.push("clean"));
		setVal(10);
		setVal(20);
		setVal = null;
		await gc();
		expect(arr).toEqual([0, "clean", 10, "clean", 20]);
		offFirst();

		arr = [];
		const [val1, setVal1] = createSignal(0);
		const off = sub(val1, (v) => arr.push(v), null, () => arr.push("clean"));
		setVal1(10);
		setVal1(20);
		off();
		setVal1(30);
		expect(arr).toEqual([0, "clean", 10, "clean", 20, "clean"]);
	});

	it("usignal", async () => {
		const { effect, signal, Signal } = await import("usignal");
		let arr = [];

		api.effect = effect;
		api.is = (v) => v instanceof Signal;
		api.get = (v) => v?.value;

		let val = signal(0);
		sub(val, (v) => arr.push(v), null, () => arr.push("clean"));
		await tick();
		val.value = 10;
		await tick();
		val.value = 20;
		await tick();
		val = null;
		await gc();
		expect(arr).toEqual([0, "clean", 10, "clean", 20]);

		arr = [];
		const val1 = signal(0);
		const off = sub(val1, (v) => arr.push(v), null, () => arr.push("clean"));
		await tick();
		val1.value = 10;
		await tick();
		val1.value = 20;
		await tick();
		off();
		val1.value = 30;
		expect(arr).toEqual([0, "clean", 10, "clean", 20, "clean"]);
	});

	it("@webreflection/signal", async () => {
		const { effect, signal, Signal } = await import("@webreflection/signal");
		let arr = [];

		api.effect = effect;
		api.is = (v) => v instanceof Signal;
		api.get = (v) => v?.value;

		let val = signal(0);
		sub(val, (v) => arr.push(v), null, () => arr.push("clean"));
		val.value = 10;
		val.value = 20;
		val = null;
		await gc();
		expect(arr).toEqual([0, "clean", 10, "clean", 20]);

		arr = [];
		const val1 = signal(0);
		const off = sub(val1, (v) => arr.push(v), null, () => arr.push("clean"));
		val1.value = 10;
		val1.value = 20;
		off();
		val1.value = 30;
		expect(arr).toEqual([0, "clean", 10, "clean", 20, "clean"]);
	});

	it("ulive", async () => {
		const { effect, signal } = await import("ulive");
		let arr = [];

		api.effect = effect;
		api.is = (v) => typeof v?.peek === "function";
		api.get = (v) => v?.value;

		let val = signal(0);
		sub(val, (v) => arr.push(v), null, () => arr.push("clean"));
		val.value = 10;
		val.value = 20;
		val = null;
		await gc();
		expect(arr).toEqual([0, "clean", 10, "clean", 20]);

		arr = [];
		const val1 = signal(0);
		const off = sub(val1, (v) => arr.push(v), null, () => arr.push("clean"));
		val1.value = 10;
		val1.value = 20;
		off();
		val1.value = 30;
		expect(arr).toEqual([0, "clean", 10, "clean", 20, "clean"]);
	});

	it("function", () => {
		const fun = () => "fun";
		const arr = [];
		sub(fun, (v) => arr.push(v));
		expect(arr).toEqual(["fun"]);
	});

	it("api.any", async () => {
		api.effect = undefined;
		api.any = (target) => (next) => target?.(next);

		const makeStore =
			(val, cb = []) =>
			(c) =>
				c === void 0
					? val
					: c.call
						? cb.splice.bind(cb, cb.push(c) - 1, 1, 0)
						: ((val = c), cb.map((f) => f && f(val)));

		let arr = [];
		;(() => {
			const val = makeStore(0);
			sub(val, (v) => arr.push(v));
			val(10);
			val(20);
		})();
		await gc();
		expect(arr).toEqual([10, 20]);

		arr = [];
		const val1 = makeStore(0);
		const off = sub(val1, (v) => arr.push(v));
		val1(10);
		val1(20);
		off();
		val1(30);
		expect(arr).toEqual([10, 20]);
	});

	it("effect-owned subscription is released (not parked in FinalizationRegistry)", async () => {
		for (const [name, impl, apiObj] of [
			["src", sub, api],
			["lite", liteSub, liteApi],
			["tiny", tinySub, tinyApi],
		]) {
			const refs = effectOwnedSubs(impl, apiObj);
			resetAllApis();
			await gc();
			const held = refs.filter((r) => r.deref() !== undefined).length;
			expect(held, `${name} retained ${held}/${refs.length} refs`).toBe(0);
		}
	});

	it("non-effect subscriptions are parked for the source-GC safety net", async () => {
		const arr = [];
		;(() => {
			const mock = {
				subscribe() {
					arr.push("sub");
					return { unsubscribe: () => arr.push("unsub") };
				},
			};
			sub(mock, (v) => arr.push(v));
		})();
		expect(arr).toEqual(["sub"]);
		await gc();
		expect(arr).toEqual(["sub", "unsub"]);
	});
});

import net from "node:net";
import { beforeEach, describe, expect, it } from "vitest";
import { api, get, is as srcIs, sub } from "../src/index.js";
import { api as liteApi, get as liteGet, is as liteIs, sub as liteSub } from "../lite/index.js";
import { api as tinyApi, get as tinyGet, is as tinyIs, sub as tinySub } from "../tiny/index.js";
import { load as httpsLoad, resolve as httpsResolve } from "./https-loader.js";
import { createApiResetter, gc, tick } from "./helpers.js";

const resetAllApis = createApiResetter(api, liteApi, tinyApi);

const variants = [
	{ name: "src", sub, api, is: srcIs, get, hasSubscribe: true, hasObserv: true, hasAsyncIter: true },
	{ name: "lite", sub: liteSub, api: liteApi, is: liteIs, get: liteGet, hasSubscribe: false, hasObserv: false, hasAsyncIter: true },
	{ name: "tiny", sub: tinySub, api: tinyApi, is: tinyIs, get: tinyGet, hasSubscribe: false, hasObserv: false, hasAsyncIter: false },
];

describe("edge cases across src, lite, and tiny", () => {
	beforeEach(() => {
		resetAllApis();
	});

	it("api defaults: effect, is, get, cleanup, any across src/lite/tiny", () => {
		for (const v of variants) {
			expect(typeof v.api.effect).toBe("function");
			expect(typeof v.api.is).toBe("function");
			expect(typeof v.api.get).toBe("function");
			expect(v.api.any).toBeUndefined();
			expect(v.api.cleanup).toBeUndefined();

			let called = 0;
			const res = v.api.effect(() => (++called, "disposer-token"));
			expect(called).toBe(1);
			expect(res).toBe("disposer-token");

			expect(Boolean(v.api.is(() => {}))).toBe(true);
			expect(Boolean(v.api.is(function named() {}))).toBe(true);
			expect(Boolean(v.api.is(async () => {}))).toBe(true);
			expect(Boolean(v.api.is(class C {}))).toBe(true);
			expect(v.api.is(null)).toBeUndefined();
			expect(v.api.is(undefined)).toBeUndefined();
			expect(v.api.is(0)).toBeUndefined();
			expect(v.api.is("str")).toBeUndefined();
			expect(v.api.is({})).toBeUndefined();
			expect(v.api.is(Object.create(null))).toBeUndefined();

			expect(v.api.get(() => 42)).toBe(42);
			expect(v.api.get(null)).toBeUndefined();
			expect(v.api.get(undefined)).toBeUndefined();
			expect(() => v.api.get({})).toThrow(TypeError);
		}
	});

	it("get(): primitives, falsy values, objects, nested functions, and hybrid signals", () => {
		const sym = Symbol("sym");
		const obj = { a: 1 };
		const nullProto = Object.create(null);
		const arr = [1, 2, 3];
		const date = new Date(0);
		const regex = /abc/gi;
		const map = new Map([["k", "v"]]);
		const set = new Set([1]);
		const prom = Promise.resolve(99);

		for (const v of variants) {
			expect(Object.is(v.get(0), 0)).toBe(true);
			expect(Object.is(v.get(-0), -0)).toBe(true);
			expect(v.get(42)).toBe(42);
			expect(v.get(Infinity)).toBe(Infinity);
			expect(Number.isNaN(v.get(NaN))).toBe(true);
			expect(v.get("")).toBe("");
			expect(v.get("hello")).toBe("hello");
			expect(v.get(false)).toBe(false);
			expect(v.get(true)).toBe(true);
			expect(v.get(null)).toBeNull();
			expect(v.get(undefined)).toBeUndefined();
			expect(v.get(0n)).toBe(0n);
			expect(v.get(123n)).toBe(123n);
			expect(v.get(sym)).toBe(sym);

			expect(v.get(obj)).toBe(obj);
			expect(v.get(nullProto)).toBe(nullProto);
			expect(v.get(arr)).toBe(arr);
			expect(v.get(date)).toBe(date);
			expect(v.get(regex)).toBe(regex);
			expect(v.get(map)).toBe(map);
			expect(v.get(set)).toBe(set);
			expect(v.get(prom)).toBe(prom);

			expect(v.get(() => 99)).toBe(99);
			expect(v.get(() => 0)).toBe(0);
			expect(v.get(() => false)).toBe(false);
			expect(v.get(() => "")).toBe("");
			expect(v.get(() => null)).toBeNull();
			expect(v.get(() => undefined)).toBeUndefined();
			expect(Number.isNaN(v.get(() => NaN))).toBe(true);
			expect(v.get((x = 7) => x)).toBe(7);
			expect(v.get(() => () => () => () => "deep")).toBe("deep");

			const box = (val) => ({ __sig: true, val });
			v.api.is = (x) => Boolean(x && x.__sig);
			v.api.get = (x) => x.val;

			expect(v.get(box(10))).toBe(10);
			expect(v.get(box(0))).toBe(0);
			expect(v.get(box(null))).toBeNull();
			expect(v.get(box(box(box("nested-sig"))))).toBe("nested-sig");
			expect(v.get(() => "plain-fn")).toBe("plain-fn");
			expect(v.get(() => () => "double-fn")).toBe("double-fn");
			expect(v.get(() => box(55))).toBe(55);
			expect(v.get(box(() => 66))).toBe(66);
			expect(v.get(() => box(() => box(() => "alternating")))).toBe("alternating");

			expect(() => v.get(class Klass {})).toThrow(TypeError);
			expect(() => v.get({ call: true })).toThrow(TypeError);
			const selfRef = () => selfRef;
			expect(() => v.get(selfRef)).toThrow(RangeError);
			expect(() => v.get({ __sig: true, get val() { throw new Error("boom-get"); } })).toThrow(/boom-get/);
		}
	});

	it("is(): falsy passthrough, non-observables, and src/lite/tiny feature matrix", () => {
		for (const v of variants) {
			expect(v.is(undefined)).toBeUndefined();
			expect(v.is(null)).toBeNull();
			expect(v.is(false)).toBe(false);
			expect(Object.is(v.is(0), 0)).toBe(true);
			expect(Object.is(v.is(-0), -0)).toBe(true);
			expect(Number.isNaN(v.is(NaN))).toBe(true);
			expect(v.is("")).toBe("");
			expect(v.is(0n)).toBe(0n);

			expect(v.is(true)).toBe(false);
			expect(v.is(1)).toBe(false);
			expect(v.is(-99)).toBe(false);
			expect(v.is(Infinity)).toBe(false);
			expect(v.is("hello")).toBe(false);
			expect(v.is(1n)).toBe(false);
			expect(v.is(Symbol("x"))).toBe(false);
			expect(v.is({})).toBe(false);
			expect(v.is(Object.create(null))).toBe(false);
			expect(v.is([1, 2, 3])).toBe(false);
			expect(v.is(new Set([1]))).toBe(false);
			expect(v.is(new Map())).toBe(false);
			expect(v.is(new WeakMap())).toBe(false);
			expect(v.is({ set() {} })).toBe(false);
			expect(v.is((function* () { yield 1; })())).toBe(false);

			const symObs = { [Symbol.observable]: () => ({ subscribe() {} }) };
			const subObj = { subscribe() {} };
			const observFn = Object.assign(() => {}, { set() {} });
			const asyncIterObj = { [Symbol.asyncIterator]: async function* () {} };
			const asyncGen = (async function* () {})();
			const realPromise = Promise.resolve(1);
			const thenable = { then() {} };
			const plainFn = () => {};

			expect(v.is(symObs)).toBe(v.hasSubscribe);
			expect(v.is(subObj)).toBe(v.hasSubscribe);
			expect(v.is(observFn)).toBe(true);
			expect(v.is(asyncIterObj)).toBe(v.hasAsyncIter);
			expect(v.is(asyncGen)).toBe(v.hasAsyncIter);
			expect(v.is(realPromise)).toBe(true);
			expect(v.is(thenable)).toBe(true);
			expect(v.is(plainFn)).toBe(true);

			v.api.is = (x) => Boolean(x && x.$customSignal);
			expect(v.is({ $customSignal: true })).toBe(true);
			expect(v.is(plainFn)).toBe(true);
			expect(v.is({ $customSignal: false })).toBe(false);
		}
	});

	it("sub(): falsy targets, truthy primitives, Symbols, and plain objects safely no-op", () => {
		for (const v of variants) {
			let called = false;
			const spy = () => { called = true; };

			expect(v.sub(undefined, spy)).toBeUndefined();
			expect(v.sub(null, spy)).toBeNull();
			expect(v.sub(false, spy)).toBe(false);
			expect(Object.is(v.sub(0, spy), 0)).toBe(true);
			expect(Object.is(v.sub(-0, spy), -0)).toBe(true);
			expect(Number.isNaN(v.sub(NaN, spy))).toBe(true);
			expect(v.sub("", spy)).toBe("");
			expect(v.sub(0n, spy)).toBe(0n);

			for (const nonObs of [
				42,
				"non-empty",
				true,
				1n,
				Symbol("local-sym"),
				Symbol.for("global-sym"),
				{},
				Object.create(null),
				[1, 2, 3],
				new Map(),
				new Set(),
			]) {
				const ret = v.sub(nonObs, spy, spy, spy);
				expect(Boolean(ret)).toBe(false);
			}

			expect(called).toBe(false);
		}
	});

	it("Observable: Symbol.observable, teardown variants, unwrapping, errors, complete+off & double-off dedup", async () => {
		expect(typeof Symbol.observable).toBe("symbol");

		// 5a. [Symbol.observable] wrapper completing synchronously + subsequent off()
		{
			const events = [];
			const interopObs = {
				[Symbol.observable]() {
					return {
						subscribe(next, _error, complete) {
							next(1);
							next(() => 2);
							next(0);
							next(false);
							next("");
							next(null);
							complete();
							return () => events.push("fn-teardown");
						},
					};
				},
			};
			const off = sub(
				interopObs,
				(v) => events.push(["next", v]),
				(e) => events.push(["err", e]),
				() => events.push("cleanup"),
			);
			expect(events).toEqual([
				["next", 1],
				["next", 2],
				["next", 0],
				["next", false],
				["next", ""],
				["next", null],
				"cleanup",
			]);
			off();
			expect(events).toEqual([
				["next", 1],
				["next", 2],
				["next", 0],
				["next", false],
				["next", ""],
				["next", null],
				"cleanup",
				"fn-teardown",
			]);
		}

		// 5b. Uncompleted observable: manual off() runs teardown + cleanup once and is idempotent
		{
			const events = [];
			const liveObs = {
				subscribe(next) {
					next("a");
					return () => events.push("teardown");
				},
			};
			const off = sub(liveObs, (v) => events.push(v), null, () => (events.push("clean"), "clean-ret"));
			expect(off()).toBe("clean-ret");
			expect(events).toEqual(["a", "teardown", "clean"]);
			expect(off()).toBe(0);
			expect(events).toEqual(["a", "teardown", "clean"]);
		}

		// 5c. [Symbol.observable]() returning null falls back to target.subscribe
		{
			const events = [];
			const fallbackObs = {
				[Symbol.observable]: () => null,
				subscribe(next) {
					next("from-target-subscribe");
					return {
						tag: "sub-obj",
						unsubscribe() {
							events.push(`unsub:${this.tag}`);
						},
					};
				},
			};
			const off = sub(fallbackObs, (v) => events.push(v));
			expect(events).toEqual(["from-target-subscribe"]);
			expect(off()).toBeUndefined();
			expect(events).toEqual(["from-target-subscribe", "unsub:sub-obj"]);
		}

		// 5d. subscribe() returning truthy object without .unsubscribe
		{
			const events = [];
			const bareSubObs = {
				subscribe(next) {
					next("ok");
					return {};
				},
			};
			const off = sub(bareSubObs, (v) => events.push(v), null, () => events.push("clean"));
			expect(events).toEqual(["ok"]);
			off();
			expect(events).toEqual(["ok", "clean"]);
		}

		// 5e. Observable error callback forwarding
		{
			const events = [];
			const errObs = {
				subscribe(_next, error) {
					error(new Error("obs-fail"));
					return () => events.push("teardown");
				},
			};
			const off = sub(errObs, (v) => events.push(v), (e) => events.push(e.message), () => events.push("clean"));
			expect(events).toEqual(["obs-fail"]);
			off();
			expect(events).toEqual(["obs-fail", "teardown", "clean"]);
		}

		// 5f. subscribe() returning undefined does NOT fall through into asyncIterator
		{
			const events = [];
			const voidSubObs = {
				subscribe(next) {
					next("from-void-subscribe");
					return undefined;
				},
				async *[Symbol.asyncIterator]() {
					yield "must-not-run";
				},
			};
			const off = sub(voidSubObs, (v) => events.push(v), (e) => events.push(e), () => events.push("done"));
			await tick(4);
			expect(events).toEqual(["from-void-subscribe"]);
			off();
			expect(events).toEqual(["from-void-subscribe", "done"]);
		}

		// 5g. Manual unsubscribe prevents duplicate teardown when target is later GC'd
		{
			const events = [];
			;(() => {
				const obs = {
					subscribe() {
						events.push("sub");
						return () => events.push("teardown");
					},
				};
				const off = sub(obs, () => {}, null, () => events.push("clean"));
				off();
			})();
			expect(events).toEqual(["sub", "teardown", "clean"]);
			await gc();
			expect(events).toEqual(["sub", "teardown", "clean"]);
		}

		// 5h. Malformed [Symbol.observable] returning object without .subscribe falls through safely
		{
			const errs = [];
			const malformed = { [Symbol.observable]: () => ({}) };
			sub(malformed, () => {}, (e) => errs.push(e instanceof TypeError));
			await tick(3);
			expect(errs).toEqual([true]);
		}
	});

	it("observ-* pattern: manual off, unwrapping, null next, GC cleanup, .set fallthrough, and lite/tiny diff", async () => {
		const { default: Observ } = await import("observ");
		const { default: Observable } = await import("observable");

		{
			const arr = [];
			const v = Observ(10);
			const off = sub(v, (x) => arr.push(x));
			sub(v, null);
			v.set(20);
			v.set(() => 25);
			off();
			v.set(30);
			expect(arr).toEqual([20, 25]);
		}
		{
			const arr = [];
			const v = Observable(10);
			const off = sub(v, (x) => arr.push(x));
			v(20);
			v.set(25);
			off();
			v(30);
			expect(arr).toEqual([10, 20, 25]);
		}

		{
			const events = [];
			;(() => {
				const fn = (listener) => {
					events.push(["listen", typeof listener]);
					return () => events.push("observ-gc-unsub");
				};
				fn.set = () => {};
				sub(fn, () => {});
			})();
			expect(events).toEqual([["listen", "function"]]);
			await gc();
			expect(events).toEqual([["listen", "function"], "observ-gc-unsub"]);
		}

		{
			const arr = [];
			const setWithPromise = {
				set: () => {},
				then(ok) {
					ok(777);
					return Promise.resolve();
				},
			};
			sub(setWithPromise, (x) => arr.push(x), null, () => arr.push("done"));
			expect(arr).toEqual([777, "done"]);

			api.is = (x) => Boolean(x && x.__sigWithSet);
			api.get = (x) => x.val;
			const sigArr = [];
			sub({ __sigWithSet: true, set() {}, val: 88 }, (x) => sigArr.push(x), null, () => {});
			expect(sigArr).toEqual([88]);
			resetAllApis();
		}

		{
			const arr = [];
			const voidObserv = (arg) => (arg === undefined ? "read-val" : undefined);
			voidObserv.set = () => {};
			sub(voidObserv, (x) => arr.push(x), null, () => arr.push("clean"));
			expect(arr).toEqual(["read-val"]);

			// Zero-arg callable signal getter with `.set` (reflex / @maverick-js/signals shape) skips observ branch
			const zeroArgCalls = [];
			const zeroArgSig = (...args) => (zeroArgCalls.push(args.length), () => "nested-fn-val");
			zeroArgSig.set = () => {};
			const sigEvents = [];
			sub(zeroArgSig, (x) => sigEvents.push(x));
			expect(zeroArgCalls).toEqual([0]);
			expect(sigEvents).toEqual(["nested-fn-val"]);
		}

		{
			const liteArr = [];
			const tinyArr = [];
			const v1 = Observ(5);
			const v2 = Observ(6);
			liteSub(v1, (x) => liteArr.push(x), null, () => {});
			tinySub(v2, (x) => tinyArr.push(x), null, () => {});
			v1.set(50);
			v2.set(60);
			expect(liteArr).toEqual([5]);
			expect(tinyArr).toEqual([6]);
		}
	});

	it("api customization: default effect, no-cleanup fn, api.cleanup, || target.call, void-disposer, api.any & GC", async () => {
		for (const v of variants) {
			const events = [];
			const cleanFn = () => events.push("clean-fn");
			v.api.cleanup = (c) => events.push(["api.cleanup", c === cleanFn]);

			const ret = v.sub(() => () => "val", (x) => events.push(["next", x]), null, cleanFn);
			expect(ret).toBe(cleanFn);
			expect(events).toEqual([["next", "val"], ["api.cleanup", true]]);
			v.api.cleanup = undefined;

			const noCleanEvents = [];
			;(() => {
				const fn = () => "once";
				const off = v.sub(fn, (x) => noCleanEvents.push(["next", x]), (e) => noCleanEvents.push(["err", e]));
				expect(off).toBeUndefined();
			})();
			expect(noCleanEvents).toEqual([["next", "once"]]);
		}

		for (const v of variants) {
			v.api.is = (x) => Boolean(x && x.__onlyCustom);
			v.api.get = (x) => x.val;
			const out = [];
			const cleanup = () => "c";
			const off = v.sub(() => "via-target-call", (x) => out.push(x), null, cleanup);
			expect(out).toEqual(["via-target-call"]);
			expect(off).toBe(cleanup);
		}
		resetAllApis();

		// Void-disposer effect (like bare Solid.js `createEffect`)
		for (const v of variants) {
			let rerun;
			let cleanPending;
			v.api.effect = (fn) => {
				rerun = () => {
					cleanPending?.();
					cleanPending = undefined;
					fn();
				};
				rerun();
			};
			v.api.cleanup = (c) => { cleanPending = c; };
			let val = 10;
			const solidSig = () => val;
			solidSig.then = () => { throw new Error("must not fall through to .then"); };
			solidSig[Symbol.asyncIterator] = () => { throw new Error("must not fall through to asyncIterator"); };
			const log = [];
			const ret = v.sub(solidSig, (x) => log.push(x), null, () => log.push("clean"));
			expect(ret).toBeUndefined();
			val = 20;
			rerun();
			val = 30;
			rerun();
			expect(log).toEqual([10, "clean", 20, "clean", 30]);
		}
		resetAllApis();

		// `api.any` selective fallback & `api.effect = undefined`
		for (const v of variants) {
			const log = [];
			v.api.is = (x) => Boolean(x && x.kind);
			v.api.get = (x) => x.val;
			v.api.effect = (f) => (f(), () => log.push("effect-dispose"));
			v.api.any = (target) => {
				if (target.kind === "decline-outer") return undefined;
				if (target.kind === "decline-inner") return () => undefined;
				return (next, error, cleanup) => {
					next(`any:${target.val}`);
					error?.("any-err");
					cleanup?.();
					return () => log.push(`any-off:${target.val}`);
				};
			};

			const off1 = v.sub({ kind: "decline-outer", val: 1 }, (x) => log.push(x));
			const off2 = v.sub({ kind: "decline-inner", val: 2 }, (x) => log.push(x));
			const off3 = v.sub(
				{ kind: "handled", val: 3 },
				(x) => log.push(x),
				(e) => log.push(e),
				() => log.push("any-clean"),
			);

			expect(log).toEqual([1, 2, "any:3", "any-err", "any-clean"]);
			off1();
			off2();
			off3();
			expect(log.slice(-3)).toEqual(["effect-dispose", "effect-dispose", "any-off:3"]);

			v.api.any = undefined;
			v.api.effect = undefined;
			const errs = [];
			const offNone = v.sub({ kind: "no-handler", val: 4 }, () => {}, (e) => errs.push(e));
			expect(offNone).toBeUndefined();
			expect(errs).toEqual([]);
		}
		resetAllApis();

		// FinalizationRegistry GC cleanup on `api.any` across src, lite, tiny
		{
			const gcEvents = [];
			for (const v of variants) {
				v.api.is = (x) => Boolean(x && x.__anyGc);
				v.api.any = (target) => {
					const id = target.id;
					return () => () => gcEvents.push(`${v.name}:${id}`);
				};
			}
			;(() => {
				for (const v of variants) {
					v.sub({ __anyGc: true, id: "dropped" }, () => {});
				}
			})();
			resetAllApis();

			await gc();
			expect(gcEvents.sort()).toEqual(["lite:dropped", "src:dropped", "tiny:dropped"]);
		}

		// Preact Signals via `api` in `lite` and `tiny`
		{
			const { effect, signal, Signal } = await import("@preact/signals-core");
			for (const v of [variants[1], variants[2]]) {
				v.api.effect = effect;
				v.api.is = (x) => x instanceof Signal;
				v.api.get = (x) => x.value;

				const seen = [];
				const sig = signal(1);
				const off = v.sub(sig, (x) => seen.push(x), null, () => seen.push("clean"));
				sig.value = 2;
				off();
				sig.value = 3;
				expect(seen).toEqual([1, "clean", 2, "clean"]);
			}
		}
	});

	it("Promise & Thenables: resolve, reject, falsy/unwrapped values, stop cancellation, sync thenable", async () => {
		for (const v of variants) {
			{
				const log = [];
				const p = Promise.resolve(() => () => 42);
				const off = v.sub(p, (x) => log.push(x), (e) => log.push(e), () => log.push("done"));
				expect(typeof off).toBe("function");
				await tick(3);
				expect(log).toEqual([42, "done"]);
			}
			{
				const log = [];
				for (const val of [0, false, "", null, undefined]) {
					v.sub(Promise.resolve(val), (x) => log.push(x));
				}
				await tick(3);
				expect(log).toEqual([0, false, "", null, undefined]);
			}
			{
				const log = [];
				const p = Promise.reject(new Error(`fail-${v.name}`));
				v.sub(p, (x) => log.push(["next", x]), (e) => log.push(["err", e.message]), () => log.push("done"));
				await tick(3);
				expect(log).toEqual([["err", `fail-${v.name}`]]);
			}
			{
				const log = [];
				let resolveP;
				const p = new Promise((r) => { resolveP = r; });
				const off = v.sub(p, (x) => log.push(["next", x]), (e) => log.push(["err", e]), () => log.push("cleanup"));
				off();
				resolveP("late-value");
				await tick(3);
				expect(log).toEqual([]);
			}
			{
				const log = [];
				const syncThenable = {
					then(ok) {
						ok("sync-ok");
						return this;
					},
				};
				const off = v.sub(syncThenable, (x) => log.push(x), null, () => log.push("sync-done"));
				expect(log).toEqual(["sync-ok", "sync-done"]);
				expect(typeof off).toBe("function");
			}
		}

		{
			const tinyLog = [];
			const voidThenable = { then(ok) { ok("tiny-sync"); } };
			const ret = tinySub(voidThenable, (x) => tinyLog.push(x), null, () => tinyLog.push("done"));
			expect(tinyLog).toEqual(["tiny-sync", "done"]);
			expect(ret).toBeUndefined();
		}
	});

	it("AsyncIterable: values, empty stream, mid-stream stop, immediate stop, errors, and absence in tiny", async () => {
		for (const v of [variants[0], variants[1]]) {
			{
				const log = [];
				async function* gen() {
					yield 0;
					yield "";
					yield false;
					yield () => "unwrapped";
				}
				const off = v.sub(gen(), (x) => log.push(x));
				expect(typeof off).toBe("function");
				await tick(10);
				expect(log).toEqual([0, "", false, "unwrapped"]);
			}
			{
				const log = [];
				async function* empty() {}
				v.sub(empty(), (x) => log.push(["next", x]), (e) => log.push(["err", e]), () => log.push("empty-done"));
				await tick(5);
				expect(log).toEqual(["empty-done"]);
			}
			{
				const log = [];
				let stepResolve;
				async function* controlled() {
					try {
						yield 1;
						yield await new Promise((r) => { stepResolve = r; });
						yield 3;
					} finally {
						log.push("generator-finally");
					}
				}
				const off = v.sub(
					controlled(),
					(x) => log.push(["next", x]),
					(e) => log.push(["err", e]),
					() => log.push("cleanup"),
				);
				await tick(4);
				expect(log).toEqual([["next", 1]]);

				off();
				stepResolve(2);
				await tick(6);
				expect(log).toEqual([["next", 1], "generator-finally"]);
			}
			{
				const log = [];
				let firstResolve;
				async function* delayed() {
					yield await new Promise((r) => { firstResolve = r; });
				}
				const off = v.sub(delayed(), (x) => log.push(x), null, () => log.push("cleanup"));
				off();
				firstResolve("never-seen");
				await tick(6);
				expect(log).toEqual([]);
			}
			{
				const log = [];
				async function* failing() {
					yield "before-err";
					throw new Error(`iter-boom-${v.name}`);
				}
				v.sub(
					failing(),
					(x) => log.push(["next", x]),
					(e) => log.push(["err", e.message]),
					() => log.push("cleanup"),
				);
				await tick(6);
				expect(log).toEqual([["next", "before-err"], ["err", `iter-boom-${v.name}`]]);
			}
			{
				const log = [];
				async function* failingNoHandler() {
					yield "ok";
					throw new Error("swallowed");
				}
				v.sub(failingNoHandler(), (x) => log.push(x));
				await tick(6);
				expect(log).toEqual(["ok"]);
			}
		}

		{
			const log = [];
			async function* gen() { yield 1; }
			const g = gen();
			expect(tinyIs(g)).toBe(false);
			expect(tinySub(g, (x) => log.push(x))).toBeUndefined();
			await tick(4);
			expect(log).toEqual([]);
		}
	});

	it("Protocol precedence order: [Symbol.observable] > .subscribe > .set+call > api.any > api.effect > .then > asyncIterator", async () => {
		{
			const log = [];
			const dual = {
				[Symbol.observable]: () => ({
					subscribe(next) { next("sym-observable"); return () => {}; },
				}),
				subscribe(next) { next("dot-subscribe"); return () => {}; },
			};
			sub(dual, (x) => log.push(x));
			expect(log).toEqual(["sym-observable"]);
		}
		{
			const log = [];
			const fn = () => { log.push("called-observ"); return () => {}; };
			fn.set = () => {};
			fn.subscribe = (next) => { next("dot-subscribe"); return () => {}; };
			sub(fn, (x) => log.push(x));
			expect(log).toEqual(["dot-subscribe"]);
		}
		{
			for (const v of variants) {
				v.api.any = () => (next) => { next("from-any"); return () => {}; };
				const log = [];
				const fn = (cb) => { cb("from-observ"); return () => {}; };
				fn.set = () => {};
				v.sub(fn, (x) => log.push(x));
				expect(log).toEqual([v.hasObserv ? "from-observ" : "from-any"]);
			}
			resetAllApis();
		}
		{
			for (const v of variants) {
				const log = [];
				const callableThenable = Object.assign(() => "from-call", {
					then(ok) { ok("from-then"); return Promise.resolve(); },
				});
				v.sub(callableThenable, (x) => log.push(x), null, () => {});
				await tick(3);
				expect(log).toEqual(["from-call"]);
			}
		}
		{
			for (const v of [variants[0], variants[1]]) {
				const log = [];
				const thenableAsyncIter = {
					then(ok) { ok("from-then"); return Promise.resolve(); },
					async *[Symbol.asyncIterator]() { yield "from-async-iter"; },
				};
				v.sub(thenableAsyncIter, (x) => log.push(x), null, () => log.push("done"));
				await tick(4);
				expect(log).toEqual(["from-then", "done"]);
			}
		}
	});

	it("Advanced edge cases: BehaviorSubject/ReplaySubject, multi-sub isolation, null next safety, parameter slots & GC retention", async () => {
		const { BehaviorSubject, ReplaySubject, Subject } = await import("rxjs");

		{
			const bs = new BehaviorSubject("init");
			const seen = [];
			const off = sub(bs, (x) => seen.push(x), null, () => seen.push("clean"));
			expect(seen).toEqual(["init"]);
			bs.next("second");
			off();
			bs.next("ignored");
			expect(seen).toEqual(["init", "second", "clean"]);
		}

		{
			const rs = new ReplaySubject(2);
			rs.next("r1");
			rs.next(() => "r2");
			rs.next("r3");
			const seen = [];
			const off = sub(rs, (x) => seen.push(x));
			expect(seen).toEqual(["r2", "r3"]);
			off();
		}

		{
			const subj = new Subject();
			const a = [], b = [], c = [];
			const offA = sub(subj, (x) => a.push(x));
			const offB = sub(subj, (x) => b.push(x));
			const offC = sub(subj, (x) => c.push(x));
			subj.next(1);
			offB();
			subj.next(2);
			offA();
			subj.next(3);
			offC();
			expect(a).toEqual([1, 2]);
			expect(b).toEqual([1]);
			expect(c).toEqual([1, 2, 3]);

			let resolveShared;
			const sharedP = new Promise((r) => { resolveShared = r; });
			const pKept = [], pCancelled = [];
			sub(sharedP, (x) => pKept.push(x), null, () => pKept.push("done"));
			const cancelOne = liteSub(sharedP, (x) => pCancelled.push(x), null, () => pCancelled.push("done"));
			cancelOne();
			resolveShared("shared-val");
			await tick(4);
			expect(pKept).toEqual(["shared-val", "done"]);
			expect(pCancelled).toEqual([]);

			const reusableAsync = {
				async *[Symbol.asyncIterator]() {
					yield "x";
					yield "y";
				},
			};
			const iter1 = [], iter2 = [];
			sub(reusableAsync, (x) => iter1.push(x));
			liteSub(reusableAsync, (x) => iter2.push(x));
			await tick(6);
			expect(iter1).toEqual(["x", "y"]);
			expect(iter2).toEqual(["x", "y"]);
		}

		// Null/omitted `next` across all protocols
		{
			const obsLog = [];
			const emitObs = { subscribe(n, _e, complete) { n(1); n(2); complete(); return () => {}; } };
			sub(emitObs, null, null, () => obsLog.push("obs-complete"));
			expect(obsLog).toEqual(["obs-complete"]);

			for (const v of variants) {
				const cleanLog = [];
				const off = v.sub(() => 123, null, null, () => cleanLog.push("fn-clean"));
				off();
				expect(cleanLog).toEqual(["fn-clean"]);

				const pLog = [];
				v.sub(Promise.resolve(456), null, null, () => pLog.push("prom-clean"));
				await tick(3);
				expect(pLog).toEqual(["prom-clean"]);
			}

			for (const v of [variants[0], variants[1]]) {
				const aiLog = [];
				async function* items() { yield 1; yield 2; }
				v.sub(items(), null, (e) => aiLog.push(["err", e]), () => aiLog.push("ai-clean"));
				await tick(6);
				expect(aiLog).toEqual(["ai-clean"]);
			}
		}

		// Internal parameter-slot edge cases
		{
			for (const v of variants) {
				const log = [];
				v.sub(Promise.resolve("skipped"), (x) => log.push(x), null, () => log.push("clean"), 1);
				await tick(3);
				expect(log).toEqual([]);
			}

			const mockLog = [];
			;(() => {
				const mock = { subscribe() { mockLog.push("sub"); return () => mockLog.push("gc-unsub"); } };
				sub(mock, () => {}, null, null, undefined, undefined, 1);
			})();
			await gc();
			expect(mockLog).toEqual(["sub"]);
		}

		// FinalizationRegistry retention hazard check on `api.any` + `lite` undefined-unsub GC check
		{
			let retainedRef, collectedRef;
			const makeRetaining = (tObj) => () => tObj;
			const makeNonRetaining = () => () => {};
			api.is = (x) => Boolean(x && x.__retTest);
			api.any = (target) => () => (target.retainSelf ? makeRetaining(target) : makeNonRetaining());
			liteApi.effect = undefined;

			;(() => {
				const leaked = { __retTest: true, retainSelf: true };
				const freed = { __retTest: true, retainSelf: false };
				const liteVoidTarget = () => 1;
				retainedRef = new WeakRef(leaked);
				collectedRef = new WeakRef(freed);
				sub(leaked, () => {});
				sub(freed, () => {});
				liteSub(liteVoidTarget, () => {});
			})();
			resetAllApis();

			await gc();
			expect(collectedRef.deref()).toBeUndefined();
			expect(retainedRef.deref()).toBeDefined();
		}
	});

	it("https-loader: resolve and load hook branches", async () => {
		expect(
			httpsResolve("https://cdn.example.com/pkg.js", {}, () => {
				throw new Error("unexpected");
			}),
		).toEqual({ shortCircuit: true, url: "https://cdn.example.com/pkg.js" });

		expect(
			httpsResolve("./sub/mod.js", { parentURL: "https://cdn.example.com/dir/index.js" }, () => {
				throw new Error("unexpected");
			}),
		).toEqual({ shortCircuit: true, url: "https://cdn.example.com/dir/sub/mod.js" });

		const delegated = httpsResolve("rxjs", { parentURL: "file:///app/index.js" }, (spec, ctx) => ({
			delegated: spec,
			parent: ctx.parentURL,
		}));
		expect(delegated).toEqual({ delegated: "rxjs", parent: "file:///app/index.js" });

		const delegatedEmptyCtx = httpsResolve("./local.js", {}, (spec) => ({ delegated: spec }));
		expect(delegatedEmptyCtx).toEqual({ delegated: "./local.js" });

		const loaded = await httpsLoad("file:///app/index.js", { format: "module" }, async (url, ctx) => ({
			source: `loaded:${url}`,
			format: ctx.format,
		}));
		expect(loaded).toEqual({ source: "loaded:file:///app/index.js", format: "module" });

		// Bind a local ephemeral TCP server that immediately resets connections so the error path never depends on port 1 or firewall timeouts
		const resetServer = net.createServer((socket) => socket.destroy());
		await new Promise((resolve) => resetServer.listen(0, "127.0.0.1", resolve));
		const { port } = resetServer.address();
		try {
			await expect(httpsLoad(`https://127.0.0.1:${port}/mod.js`, {}, async () => {})).rejects.toThrow();
		} finally {
			await new Promise((resolve) => resetServer.close(resolve));
		}
	});
});

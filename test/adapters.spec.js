import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BehaviorSubject, Subject } from "rxjs";
import { api, get, is as isObs, sub } from "../src/index.js";
import { api as liteApi, get as liteGet, is as liteIs, sub as liteSub } from "../lite/index.js";
import { api as tinyApi, get as tinyGet, is as tinyIs, sub as tinySub } from "../tiny/index.js";
import { createApiResetter, gc, tick } from "./helpers.js";

import { Signal as PreactSignal, computed as preactComputed, effect as preactEffect, signal as preactSignal } from "@preact/signals-core";
import {
	createEffect as solidEffect,
	createMemo as solidMemo,
	createRoot as solidRoot,
	createSignal as solidSignal,
	onCleanup as solidCleanup,
} from "solid-js/dist/solid.js";
import { effect as obyEffect, isObservable as isObyObservable, memo as obyMemo, observable as obySignal } from "oby";
import {
	cleanup as sinuousCleanup,
	computed as sinuousComputed,
	observable as sinuousSignal,
	root as sinuousRoot,
	subscribe as sinuousSubscribe,
} from "sinuous/observable";
import { computed as uliveComputed, effect as uliveEffect, signal as uliveSignal } from "ulive";
import { Signal as USignal, computed as uSignalComputed, effect as uSignalEffect, signal as uSignal } from "usignal";
import {
	computed as vueComputed,
	effect as vueEffect,
	effectScope as vueEffectScope,
	isRef as isVueRef,
	onEffectCleanup as vueCleanup,
	shallowRef as vueSignal,
	stop as vueStop,
} from "@vue/reactivity";
import {
	computed as alienComputed,
	effect as alienEffect,
	isComputed as isAlienComputed,
	isSignal as isAlienSignal,
	signal as alienSignal,
} from "alien-signals";
import S from "s-js";
import {
	autorun as mobxAutorun,
	computed as mobxComputed,
	isBoxedObservable as isMobxBox,
	isComputed as isMobxComputed,
	observable as mobxObservable,
	runInAction as mobxAction,
} from "mobx";
import { atom as nanoAtom, computed as nanoComputed } from "nanostores";
import {
	ReadonlyStore as TanStackReadonlyStore,
	Store as TanStackStore,
	createStore as createTanStackStore,
} from "@tanstack/store";
import { Signal as WRSignal, computed as wrSignalComputed, effect as wrSignalEffect, signal as wrSignal } from "@webreflection/signal";
import { Signal as WRSignals, computed as wrSignalsComputed, effect as wrSignalsEffect, signal as wrSignals } from "@webreflection/signals";
import {
	Signal as WRAlienSignal,
	computed as wrAlienComputed,
	effect as wrAlienEffect,
	signal as wrAlienSignal,
} from "@webreflection/alien-signals";

const resetAllApis = createApiResetter(api, liteApi, tinyApi);

const variants = [
	{ name: "src", api, sub, is: isObs, get },
	{ name: "lite", api: liteApi, sub: liteSub, is: liteIs, get: liteGet },
	{ name: "tiny", api: tinyApi, sub: tinySub, is: tinyIs, get: tinyGet },
];

const sSignals = new WeakSet();
let solidDisposers = [];

const onceDispose = (effectFn) => (f) => {
	let d = effectFn(f);
	return () => {
		d?.();
		d = null;
	};
};

const signalAdapters = [
	{
		name: "Preact Signals",
		hasNativeSubscribe: true,
		usubApi: {
			is: (v) => v instanceof PreactSignal,
			get: (v) => v.value,
			effect: preactEffect,
		},
		create: (initial) => {
			const s = preactSignal(initial);
			return { target: s, set: (v) => { s.value = v; } };
		},
		memo: (fn) => preactComputed(fn),
	},
	{
		name: "Solid.js",
		usubApi: {
			is: (v) => Boolean(v?.name?.includes("readSignal")),
			get: (v) => v?.(),
			effect: (f) => solidRoot((dispose) => (solidEffect(f), dispose)),
			cleanup: (fn) => fn && solidCleanup(fn),
		},
		create: (initial) => {
			const [read, write] = solidSignal(initial);
			return { target: read, set: (v) => write(typeof v === "function" ? () => v : v) };
		},
		memo: (fn) =>
			solidRoot((dispose) => {
				solidDisposers.push(dispose);
				return solidMemo(fn);
			}),
		scope: (fn) => {
			solidDisposers = [];
			try {
				return fn();
			} finally {
				for (const d of solidDisposers.splice(0)) d();
			}
		},
	},
	{
		name: "Oby",
		usubApi: {
			is: isObyObservable,
			get: (v) => v(),
			effect: (f) => obyEffect(f, { sync: true }),
		},
		create: (initial) => {
			const s = obySignal(initial);
			return { target: s, set: (v) => s(typeof v === "function" ? () => v : v) };
		},
		memo: (fn) => obyMemo(fn),
	},
	{
		name: "Sinuous",
		usubApi: {
			is: (v) => Boolean(v?.$o),
			get: (v) => v(),
			effect: (f) => sinuousRoot((dispose) => (sinuousSubscribe(f), dispose)),
			cleanup: (fn) => fn && sinuousCleanup(fn),
		},
		create: (initial) => {
			const s = sinuousSignal(initial);
			return { target: s, set: (v) => s(v) };
		},
		memo: (fn) => sinuousComputed(fn),
		scope: (fn) =>
			sinuousRoot((dispose) => {
				try { return fn(); } finally { dispose(); }
			}),
	},
	{
		name: "ulive",
		usubApi: {
			is: (v) => typeof v?.peek === "function",
			get: (v) => v.value,
			effect: onceDispose(uliveEffect),
		},
		create: (initial) => {
			const s = uliveSignal(initial);
			return { target: s, set: (v) => { s.value = v; } };
		},
		memo: (fn) => uliveComputed(fn),
	},
	{
		name: "usignal",
		usubApi: {
			is: (v) => v instanceof USignal,
			get: (v) => v.value,
			effect: uSignalEffect,
		},
		create: (initial) => {
			const s = uSignal(initial);
			return { target: s, set: (v) => { s.value = v; } };
		},
		memo: (fn) => uSignalComputed(fn),
	},
	{
		name: "Vue reactivity",
		usubApi: {
			is: isVueRef,
			get: (v) => v.value,
			effect: (f) => {
				const runner = vueEffect(f);
				return () => vueStop(runner);
			},
			cleanup: vueCleanup,
		},
		create: (initial) => {
			const s = vueSignal(initial);
			return { target: s, set: (v) => { s.value = v; } };
		},
		memo: (fn) => vueComputed(fn),
		scope: (fn) => {
			const scope = vueEffectScope();
			try { return scope.run(fn); } finally { scope.stop(); }
		},
	},
	{
		name: "alien-signals",
		usubApi: {
			is: (v) => typeof v === "function" && (isAlienSignal(v) || isAlienComputed(v)),
			get: (v) => v(),
			effect: alienEffect,
		},
		create: (initial) => {
			const s = alienSignal(initial);
			return { target: s, set: (v) => s(v) };
		},
		memo: (fn) => alienComputed(fn),
	},
	{
		name: "S.js",
		usubApi: {
			is: (v) => sSignals.has(v),
			get: (v) => v(),
			effect: (f) => S.root((dispose) => (S(f), dispose)),
			cleanup: (fn) => fn && S.cleanup(fn),
		},
		create: (initial) => {
			const s = S.data(initial);
			sSignals.add(s);
			return { target: s, set: (v) => s(v) };
		},
		memo: (fn) => {
			const m = S(fn);
			sSignals.add(m);
			return m;
		},
		scope: (fn) =>
			S.root((dispose) => {
				try { return fn(); } finally { dispose(); }
			}),
	},
	{
		name: "MobX",
		usubApi: {
			is: (v) => isMobxBox(v) || isMobxComputed(v),
			get: (v) => v.get(),
			effect: (f) => {
				let clean;
				const off = mobxAutorun(() => {
					clean?.();
					clean = f();
				});
				return () => {
					off();
					clean?.();
					clean = null;
				};
			},
		},
		create: (initial) => {
			const box = mobxObservable.box(initial, { deep: false });
			return { target: box, set: (v) => mobxAction(() => box.set(v)) };
		},
		memo: (fn) => mobxComputed(fn),
	},
	{
		name: "@webreflection/signal",
		usubApi: {
			is: (v) => v instanceof WRSignal,
			get: (v) => v.value,
			effect: onceDispose(wrSignalEffect),
		},
		create: (initial) => {
			const s = wrSignal(initial);
			return { target: s, set: (v) => { s.value = v; } };
		},
		memo: (fn) => wrSignalComputed(fn),
	},
	{
		name: "@webreflection/signals",
		eagerInvalidation: true,
		usubApi: {
			is: (v) => v instanceof WRSignals,
			get: (v) => v.value,
			effect: wrSignalsEffect,
		},
		create: (initial) => {
			const s = wrSignals(initial);
			return { target: s, set: (v) => { s.value = v; } };
		},
		memo: (fn) => wrSignalsComputed(fn),
	},
	{
		name: "@webreflection/alien-signals",
		usubApi: {
			is: (v) => v instanceof WRAlienSignal,
			get: (v) => v.value,
			effect: wrAlienEffect,
		},
		create: (initial) => {
			const s = wrAlienSignal(initial);
			return { target: s, set: (v) => { s.value = v; } };
		},
		memo: (fn) => wrAlienComputed(fn),
	},
];

describe.each(signalAdapters)("$name adapter", (lib) => {
	beforeEach(() => {
		resetAllApis();
	});

	afterEach(() => {
		resetAllApis();
	});

	const runScoped = (fn) => (lib.scope ? lib.scope(fn) : fn());

	it.each(variants)("supports signals, memos, nested signals, cleanup & GC in $name", async (v) => {
		Object.assign(v.api, lib.usubApi);

		runScoped(() => {
			// 1. `is()` brand detection & `get()` recursive unwrapping
			const { target: s0 } = lib.create(0);
			const { target: sNested } = lib.create(lib.create("deep").target);
			const m0 = lib.memo(() => v.get(s0) + 5);

			expect(v.is(s0)).toBe(true);
			expect(v.is(m0)).toBe(true);
			expect(v.is({ plain: 1 })).toBe(false);
			expect(v.get(s0)).toBe(0);
			expect(v.get(m0)).toBe(5);
			expect(v.get(sNested)).toBe("deep");

			// 2. Writable signal reactivity, falsy values, omitted cleanup, and idempotent off()
			const { target: sig, set } = lib.create(1);
			const values = [];
			const offNoClean = v.sub(sig, (val) => values.push(val));
			expect(typeof offNoClean).toBe("function");
			set(0);
			set(false);
			set("");
			set(null);
			set(undefined);
			set(42);
			offNoClean();
			offNoClean();
			set(99);
			expect(values).toEqual([1, 0, false, "", null, undefined, 42]);

			// 3. Cleanup lifecycle
			const { target: cSig, set: cSet } = lib.create("a");
			const lifecycle = [];
			const offClean = v.sub(
				cSig,
				(val) => lifecycle.push(`next:${val}`),
				null,
				() => lifecycle.push("clean"),
			);
			cSet("b");
			offClean();
			offClean();
			cSet("c");

			const usesNativeSub = lib.hasNativeSubscribe && v.name === "src";
			expect(lifecycle).toEqual(
				usesNativeSub
					? ["next:a", "next:b", "clean"]
					: ["next:a", "clean", "next:b", "clean"],
			);

			// 4. Conditional memo dependency switching
			const { target: chooseLeft, set: setChooseLeft } = lib.create(true);
			const { target: left, set: setLeft } = lib.create(10);
			const { target: right, set: setRight } = lib.create(20);
			const selected = lib.memo(() => (v.get(chooseLeft) ? v.get(left) : v.get(right)));

			const memoEvents = [];
			const offMemo = v.sub(selected, (val) => memoEvents.push(val));
			expect(memoEvents).toEqual([10]);

			setChooseLeft(false);
			expect(memoEvents).toEqual([10, 20]);

			setLeft(30);
			expect(v.get(selected)).toBe(20);
			if (lib.eagerInvalidation) {
				expect(memoEvents).toEqual([10, 20, 20]);
				setLeft(35);
				expect(memoEvents).toEqual([10, 20, 20]);
			} else {
				expect(memoEvents).toEqual([10, 20]);
			}

			const beforeRight = [...memoEvents];
			setRight(40);
			expect(memoEvents).toEqual([...beforeRight, 40]);

			offMemo();
			setRight(50);
			expect(memoEvents).toEqual([...beforeRight, 40]);

			// 5. Nested signals (`signal(innerSignal)` and `signal(() => value)`)
			const { target: inner1, set: setInner1 } = lib.create(100);
			const { target: inner2 } = lib.create(200);
			const { target: outer, set: setOuter } = lib.create(inner1);
			const nestedEvents = [];
			const offNested = v.sub(outer, (val) => nestedEvents.push(val));
			expect(nestedEvents).toEqual([100]);

			if (!usesNativeSub) {
				setInner1(150);
				expect(nestedEvents).toEqual([100, 150]);
			}

			const prevSnapshot = [...nestedEvents];
			setOuter(inner2);
			expect(nestedEvents).toEqual([...prevSnapshot, 200]);

			setOuter(() => 300);
			expect(nestedEvents).toEqual([...prevSnapshot, 200, 300]);
			offNested();
		});

		// 6. GC check: disposed signal + subscription must not be retained by FinalizationRegistry
		const weakTarget = (() => {
			let holder;
			runScoped(() => {
				const { target, set } = lib.create(1);
				const seen = [];
				const off = v.sub(target, (x) => seen.push(x));
				set(2);
				off();
				holder = new WeakRef(target);
			});
			return holder;
		})();

		await gc();
		expect(weakTarget.deref()).toBeUndefined();
	});
});

describe("store & stream adapters (Nanostores, TanStack Store, RxJS, ulive .then, Oby scheduled)", () => {
	beforeEach(() => {
		resetAllApis();
	});

	afterEach(() => {
		resetAllApis();
	});

	it("supports Nanostores zero-config in src and via api.any in lite/tiny", () => {
		const count = nanoAtom(1);
		const doubled = nanoComputed(count, (n) => n * 2);
		const atomLog = [];
		const compLog = [];

		expect(isObs(count)).toBe(true);
		expect(isObs(doubled)).toBe(true);

		const offAtom = sub(count, (x) => atomLog.push(x), null, () => atomLog.push("atom-clean"));
		const offComp = sub(doubled, (x) => compLog.push(x), null, () => compLog.push("comp-clean"));

		count.set(0);
		count.set(5);
		offAtom();
		offAtom();
		offComp();
		count.set(10);

		expect(atomLog).toEqual([1, 0, 5, "atom-clean"]);
		expect(compLog).toEqual([2, 0, 10, "comp-clean"]);

		for (const v of [variants[1], variants[2]]) {
			resetAllApis();
			v.api.is = (x) => typeof x?.get === "function" && typeof x?.listen === "function";
			v.api.get = (x) => x.get();
			v.api.any = (store) => (next, _err, cleanup) => {
				const unbind = store.subscribe((val) => next?.(v.get(val)));
				return () => {
					unbind();
					cleanup?.();
				};
			};

			const base = nanoAtom(3);
			const derived = nanoComputed(base, (n) => n + 10);
			const nested = nanoAtom(base);
			const events = [];
			const nestedEvents = [];

			expect(v.is(base)).toBe(true);
			expect(v.get(nested)).toBe(3);

			const off1 = v.sub(derived, (x) => events.push(x), null, () => events.push("clean"));
			const off2 = v.sub(nested, (x) => nestedEvents.push(x));
			base.set(7);
			nested.set(nanoAtom(99));
			off1();
			off2();
			base.set(20);

			expect(events).toEqual([13, 17, "clean"]);
			expect(nestedEvents).toEqual([3, 99]);
		}
	});

	it("supports TanStack Store zero-config in src and via api.any in lite/tiny", () => {
		const state = new TanStackStore(10);
		const derived = createTanStackStore(() => state.state * 3);
		const stateEvents = [];
		const derivedEvents = [];

		expect(isObs(state)).toBe(true);
		expect(isObs(derived)).toBe(true);

		const offState = sub(state, (x) => stateEvents.push(x), null, () => stateEvents.push("clean"));
		const offDerived = sub(derived, (x) => derivedEvents.push(x), null, () => derivedEvents.push("derived-clean"));

		state.setState(() => 0);
		state.setState(() => 4);
		offState();
		offState();
		offDerived();
		state.setState(() => 9);

		expect(stateEvents).toEqual([0, 4, "clean"]);
		expect(derivedEvents).toEqual([0, 12, "derived-clean"]);

		for (const v of [variants[1], variants[2]]) {
			resetAllApis();
			v.api.is = (x) => x instanceof TanStackStore || x instanceof TanStackReadonlyStore;
			v.api.get = (x) => x.state;
			v.api.any = (store) => (next, _err, cleanup) => {
				next?.(v.get(store));
				const subHandle = store.subscribe(() => next?.(v.get(store)));
				return () => {
					subHandle.unsubscribe();
					cleanup?.();
				};
			};

			const count = new TanStackStore(2);
			const triple = createTanStackStore(() => count.state * 3);
			const log = [];
			const off = v.sub(triple, (x) => log.push(x), null, () => log.push("clean"));
			count.setState(() => 5);
			count.setState(() => 0);
			off();
			count.setState(() => 8);

			expect(log).toEqual([6, 15, 0, "clean"]);
		}
	});

	it("supports RxJS BehaviorSubject & Subject zero-config in src and via api.any in lite/tiny", () => {
		const bs = new BehaviorSubject(10);
		const srcLog = [];
		const offSrc = sub(bs, (x) => srcLog.push(x), null, () => srcLog.push("done"));
		bs.next(20);
		bs.complete();
		offSrc();
		expect(srcLog).toEqual([10, 20, "done"]);

		for (const v of [variants[1], variants[2]]) {
			resetAllApis();
			v.api.is = (x) => typeof x?.subscribe === "function";
			v.api.get = (x) => (typeof x.getValue === "function" ? x.getValue() : x);
			v.api.any = (obs) => (next, error, cleanup) => {
				let done = false;
				const s = obs.subscribe({
					next: (val) => next?.(v.get(val)),
					error,
					complete: () => {
						if (!done) {
							done = true;
							cleanup?.();
						}
					},
				});
				return () => {
					s.unsubscribe();
					if (!done) {
						done = true;
						cleanup?.();
					}
				};
			};

			const bsSub = new BehaviorSubject("init");
			const subj = new Subject();
			const bsLog = [];
			const subjLog = [];

			const offBs = v.sub(bsSub, (x) => bsLog.push(x), null, () => bsLog.push("bs-clean"));
			const offSubj = v.sub(subj, (x) => subjLog.push(x), (e) => subjLog.push(`err:${e}`), () => subjLog.push("subj-clean"));

			bsSub.next("next");
			offBs();
			bsSub.next("ignored");

			subj.next(1);
			subj.complete();
			offSubj();

			expect(bsLog).toEqual(["init", "next", "bs-clean"]);
			expect(subjLog).toEqual([1, "subj-clean"]);
		}
	});

	it("prioritizes api.is over ulive .then and supports Oby scheduled microtask effects", async () => {
		for (const v of variants) {
			resetAllApis();
			v.api.is = (x) => typeof x?.peek === "function";
			v.api.get = (x) => x.value;
			v.api.effect = onceDispose(uliveEffect);

			const s = uliveSignal(1);
			expect(typeof s.then).toBe("function");
			const log = [];
			const off = v.sub(s, (x) => log.push(x));
			s.value = 2;
			s.value = 3;
			off();
			s.value = 4;
			expect(log).toEqual([1, 2, 3]);
		}

		for (const v of variants) {
			resetAllApis();
			v.api.is = isObyObservable;
			v.api.get = (x) => x();
			v.api.effect = obyEffect;

			const s = obySignal("t0");
			const log = [];
			const off = v.sub(s, (x) => log.push(x), null, () => log.push("clean"));
			await tick(4);
			s("t1");
			await tick(4);
			off();
			s("t2");
			await tick(4);
			expect(log).toEqual(["t0", "clean", "t1", "clean"]);
		}
	});
});

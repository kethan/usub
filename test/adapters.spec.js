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
	computed as vue36Computed,
	effect as vue36Effect,
	effectScope as vue36EffectScope,
	isRef as isVue36Ref,
	onEffectCleanup as vue36Cleanup,
	shallowRef as vue36Signal,
	stop as vue36Stop,
} from "vue-reactivity-3.6";
import {
	computed as alienComputed,
	effect as alienEffect,
	isComputed as isAlienComputed,
	isSignal as isAlienSignal,
	signal as alienSignal,
} from "alien-signals";
import S from "s-js";
import {
	computed as reflexComputed,
	createRuntime as createReflexRuntime,
	effect as reflexEffect,
	flush as reflexFlush,
	signal as reflexSignal,
} from "@volynets/reflex";
import { Reactive, stabilize } from "@reactively/core";
import { Compute as AnodCompute, Signal as AnodSignal, c as anodC, signal as anodSignal } from "anod";
import {
	computed as liteSignalComputed,
	effect as liteSignalEffect,
	onCleanup as liteSignalCleanup,
	signal as liteSignal,
} from "@zakkster/lite-signal";
import * as RSSignal from "rescript-signals/src/signals/Signal.res.mjs";
import * as RSComputed from "rescript-signals/src/signals/Computed.res.mjs";
import * as RSEffect from "rescript-signals/src/signals/Effect.res.mjs";
import * as RSScheduler from "rescript-signals/src/signals/Scheduler.res.mjs";
import {
	computed as maverickComputed,
	effect as maverickEffect,
	isReadSignal as isMaverickReadSignal,
	root as maverickRoot,
	signal as maverickSignal,
	tick as maverickTick,
} from "@maverick-js/signals";
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
const reflexSignals = new WeakSet();
let solidDisposers = [];
let anodCtx;
let anodDisposers = [];

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
		name: "@vue/reactivity 3.6",
		usubApi: {
			is: isVue36Ref,
			get: (v) => v.value,
			effect: (f) => {
				const runner = vue36Effect(f);
				return () => vue36Stop(runner);
			},
			cleanup: (fn) => fn && vue36Cleanup(fn),
		},
		create: (initial) => {
			const s = vue36Signal(initial);
			return { target: s, set: (v) => { s.value = v; } };
		},
		memo: (fn) => vue36Computed(fn),
		scope: (fn) => {
			const scope = vue36EffectScope();
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
		name: "reflex",
		usubApi: {
			is: (v) => reflexSignals.has(v),
			get: (v) => v(),
			effect: reflexEffect,
		},
		create: (initial) => {
			const s = reflexSignal(initial);
			reflexSignals.add(s);
			return {
				target: s,
				set: (v) => s.set(typeof v === "function" ? () => v : v),
			};
		},
		memo: (fn) => {
			const c = reflexComputed(fn);
			reflexSignals.add(c);
			return c;
		},
		scope: (fn) => {
			createReflexRuntime({ effectStrategy: "eager" });
			return fn();
		},
	},
	{
		name: "@reactively",
		usubApi: {
			is: (v) => v instanceof Reactive,
			get: (v) => v.get(),
			effect: (f) => {
				let clean;
				let dead = false;
				const obs = new Reactive(() => {
					if (dead) return;
					clean?.();
					clean = f();
				}, true);
				obs.get();
				return () => {
					if (dead) return;
					dead = true;
					clean?.();
					clean = undefined;
					obs.set(undefined);
				};
			},
		},
		create: (initial) => {
			const s = new Reactive(initial);
			return {
				target: s,
				set: (v) => {
					s.set(v);
					stabilize();
				},
			};
		},
		memo: (fn) => new Reactive(fn),
	},
	{
		name: "anod",
		usubApi: {
			is: (v) => v instanceof AnodSignal || v instanceof AnodCompute,
			get: (v) => (anodCtx ? anodCtx.val(v) : v.get()),
			effect: (f) => {
				const fx = anodC.effect((ctx) => {
					const prev = anodCtx;
					anodCtx = ctx;
					try { f(); } finally { anodCtx = prev; }
				});
				return () => fx.dispose();
			},
			cleanup: (fn) => fn && anodCtx?.cleanup(fn),
		},
		create: (initial) => {
			const s = anodSignal(initial);
			return { target: s, set: (v) => s.set(typeof v === "function" ? () => v : v) };
		},
		memo: (fn) => {
			const comp = anodC.compute((ctx) => {
				const prev = anodCtx;
				anodCtx = ctx;
				try { return fn(); } finally { anodCtx = prev; }
			});
			anodDisposers.push(() => comp.dispose());
			return comp;
		},
		scope: (fn) => {
			anodDisposers = [];
			try {
				return fn();
			} finally {
				for (const d of anodDisposers.splice(0)) d();
			}
		},
	},
	{
		name: "lite-signal",
		hasNativeSubscribe: true,
		usubApi: {
			is: (v) => typeof v === "function" && typeof v.peek === "function",
			get: (v) => v(),
			effect: liteSignalEffect,
			cleanup: (fn) => fn && liteSignalCleanup(fn),
		},
		create: (initial) => {
			const s = liteSignal(initial);
			return { target: s, set: (v) => s.set(v) };
		},
		memo: (fn) => liteSignalComputed(fn),
	},
	{
		name: "rescript-signals",
		usubApi: {
			is: (v) => Boolean(v && typeof v === "object" && typeof v.equals === "function" && v.subs),
			get: (v) => RSSignal.get(v),
			effect: (f) => {
				const prev = RSScheduler.currentObserverDepCursor.contents;
				try {
					const d = RSEffect.runWithDisposer(f);
					return () => d.dispose();
				} finally {
					RSScheduler.currentObserverDepCursor.contents = prev;
				}
			},
		},
		create: (initial) => {
			const s = RSSignal.make(initial);
			return { target: s, set: (v) => RSSignal.set(s, v) };
		},
		memo: (fn) => RSComputed.make(fn),
	},
	{
		name: "@maverick-js/signals",
		usubApi: {
			is: isMaverickReadSignal,
			get: (v) => v(),
			effect: maverickEffect,
		},
		create: (initial) => {
			const s = maverickSignal(initial);
			return {
				target: s,
				set: (v) => {
					s.set(typeof v === "function" ? () => v : v);
					maverickTick();
				},
			};
		},
		memo: (fn) => maverickComputed(fn),
		scope: (fn) =>
			maverickRoot((dispose) => {
				try { return fn(); } finally { dispose(); }
			}),
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

describe("store & stream adapters (Nanostores, TanStack Store, RxJS, ulive .then, Oby/@maverick/reflex modes)", () => {
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

		const offAtom = sub(count, (v) => atomLog.push(v), null, () => atomLog.push("atom-clean"));
		const offComp = sub(doubled, (v) => compLog.push(v), null, () => compLog.push("comp-clean"));

		count.set(3);
		count.set(0);
		offAtom();
		offAtom();
		offComp();
		count.set(10);

		expect(atomLog).toEqual([1, 3, 0, "atom-clean"]);
		expect(compLog).toEqual([2, 6, 0, "comp-clean"]);

		for (const v of [variants[1], variants[2]]) {
			v.api.is = (x) => typeof x?.get === "function" && typeof x?.listen === "function";
			v.api.get = (x) => x.get();
			v.api.any = (store) => (next, _err, cleanup) => {
				let done = false;
				next?.(v.get(store));
				const unsub = store.listen(() => next?.(v.get(store)));
				return () => {
					if (!done) {
						done = true;
						unsub();
						cleanup?.();
					}
				};
			};

			const a = nanoAtom("x");
			const d = nanoComputed(a, (s) => `${s}!`);
			const log = [];

			expect(v.is(a)).toBe(true);
			expect(v.get(d)).toBe("x!");

			const off = v.sub(d, (val) => log.push(val), null, () => log.push("clean"));
			a.set("y");
			off();
			off();
			a.set("z");
			expect(log).toEqual(["x!", "y!", "clean"]);
		}
	});

	it("supports TanStack Store zero-config in src and via api.any in lite/tiny", () => {
		const store = createTanStackStore(10);
		const doubled = createTanStackStore(() => store.state * 2);
		const log = [];

		expect(isObs(store)).toBe(true);
		expect(isObs(doubled)).toBe(true);

		const off = sub(
			doubled,
			() => log.push(doubled.state),
			null,
			() => log.push("clean"),
		);
		expect(log).toEqual([]);

		store.setState(() => 25);
		store.setState(() => 0);
		off();
		off();
		store.setState(() => 99);

		expect(log).toEqual([50, 0, "clean"]);

		for (const v of [variants[1], variants[2]]) {
			v.api.is = (x) => x instanceof TanStackStore || x instanceof TanStackReadonlyStore;
			v.api.get = (x) => x.state;
			v.api.any = (s) => (next, _err, cleanup) => {
				next?.(v.get(s));
				const subHandle = s.subscribe(() => next?.(v.get(s)));
				return () => {
					subHandle.unsubscribe();
					cleanup?.();
				};
			};

			const ts = createTanStackStore(5);
			const td = createTanStackStore(() => ts.state + 1);
			const seen = [];
			const offLite = v.sub(td, (val) => seen.push(val), null, () => seen.push("clean"));
			ts.setState(() => 9);
			offLite();
			ts.setState(() => 20);
			expect(seen).toEqual([6, 10, "clean"]);
		}
	});

	it("supports RxJS BehaviorSubject & Subject zero-config in src and via api.any in lite/tiny", () => {
		const bs = new BehaviorSubject(10);
		const subj = new Subject();
		const bsEvents = [];
		const subjEvents = [];

		const offBs = sub(bs, (v) => bsEvents.push(v), null, () => bsEvents.push("bs-done"));
		const offSubj = sub(subj, (v) => subjEvents.push(v), null, () => subjEvents.push("subj-done"));

		bs.next(20);
		offBs();
		bs.next(30);

		subj.next("a");
		subj.complete();
		offSubj();

		expect(bsEvents).toEqual([10, 20, "bs-done"]);
		expect(subjEvents).toEqual(["a", "subj-done"]);

		for (const v of [variants[1], variants[2]]) {
			v.api.is = (x) => typeof x?.subscribe === "function";
			v.api.get = (x) => (typeof x.getValue === "function" ? x.getValue() : x);
			v.api.any = (obs) => (next, error, cleanup) => {
				let done = false;
				const finish = () => {
					if (!done) {
						done = true;
						cleanup?.();
					}
				};
				const s = obs.subscribe({
					next: (val) => next?.(v.get(val)),
					error,
					complete: finish,
				});
				return () => {
					s.unsubscribe();
					finish();
				};
			};

			const b = new BehaviorSubject("init");
			const sj = new Subject();
			const bsLog = [];
			const subjLog = [];

			const offB = v.sub(b, (val) => bsLog.push(val), null, () => bsLog.push("bs-clean"));
			const offSj = v.sub(sj, (val) => subjLog.push(val), null, () => subjLog.push("subj-clean"));

			b.next("next");
			offB();
			b.next("ignored");

			sj.next(1);
			sj.complete();
			offSj();

			expect(bsLog).toEqual(["init", "next", "bs-clean"]);
			expect(subjLog).toEqual([1, "subj-clean"]);
		}
	});

	it("prioritizes api.is over ulive .then and supports Oby, @maverick-js/signals & reflex runtime modes", async () => {
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

		// @maverick-js/signals natural microtask-scheduled effects (without manual tick())
		for (const v of variants) {
			resetAllApis();
			v.api.is = isMaverickReadSignal;
			v.api.get = (x) => x();
			v.api.effect = maverickEffect;

			await maverickRoot(async (dispose) => {
				try {
					const s = maverickSignal("m0");
					const log = [];
					const off = v.sub(s, (x) => log.push(x), null, () => log.push("clean"));
					expect(log).toEqual(["m0"]);
					s.set("m1");
					await tick(2);
					off();
					s.set("m2");
					await tick(2);
					expect(log).toEqual(["m0", "clean", "m1", "clean"]);
				} finally {
					dispose();
				}
			});
		}

		// reflex with flush effectStrategy (batched updates flushed via flush())
		createReflexRuntime({ effectStrategy: "flush" });
		try {
			for (const v of variants) {
				resetAllApis();
				v.api.is = (x) => reflexSignals.has(x);
				v.api.get = (x) => x();
				v.api.effect = reflexEffect;

				const s = reflexSignal("r0");
				reflexSignals.add(s);
				const log = [];
				const off = v.sub(s, (x) => log.push(x), null, () => log.push("clean"));
				s.set("r1");
				expect(log).toEqual(["r0"]);
				reflexFlush();
				off();
				s.set("r2");
				reflexFlush();
				expect(log).toEqual(["r0", "clean", "r1", "clean"]);
			}
		} finally {
			createReflexRuntime({ effectStrategy: "eager" });
		}
	});
});

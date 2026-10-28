# USub

[![tests](https://github.com/kethan/usub/actions/workflows/node.js.yml/badge.svg)](https://github.com/kethan/usub/actions/workflows/node.js.yml)
[![Version](https://img.shields.io/npm/v/usub.svg?color=success&style=flat-square)](https://www.npmjs.com/package/usub)
[![Bundle size (brotli)](https://deno.bundlejs.com/badge?q=usub&treeshake=[*]&config={"compression":"brotli"})](https://unpkg.com/usub)
[![Bundle size (gzip)](https://deno.bundlejs.com/badge?q=usub&treeshake=[*]&config={"compression":"gzip"})](https://unpkg.com/usub)

#### `usub/lite`

[![Lite size (brotli)](https://deno.bundlejs.com/badge?q=usub/lite&treeshake=[*]&config={"compression":"brotli"})](https://unpkg.com/usub/lite)
[![Lite size (gzip)](https://deno.bundlejs.com/badge?q=usub/lite&treeshake=[*]&config={"compression":"gzip"})](https://unpkg.com/usub/lite)

#### `usub/tiny`

[![Tiny size (brotli)](https://deno.bundlejs.com/badge?q=usub/tiny&treeshake=[*]&config={"compression":"brotli"})](https://unpkg.com/usub/tiny)
[![Tiny size (gzip)](https://deno.bundlejs.com/badge?q=usub/tiny&treeshake=[*]&config={"compression":"gzip"})](https://unpkg.com/usub/tiny)

A tiny, dependency-free universal subscription utility for JavaScript observables, signals, promises, async iterables, and functions.

- **Tiny:** `470 B` gzipped (`355 B` for `usub/lite`, `291 B` for `usub/tiny`), zero runtime dependencies.
- **Universal:** One `sub(target, next, error, cleanup)` API across TC39/RxJS Observables, Promises, Async Iterables, `observ`/`observable`, functions, and any Signal or Store library.
- **Pluggable:** 25 tested reactive adapters (`@volynets/reflex`, `alien-signals`, `@reactively/core`, `@vue/reactivity` 3.5 & 3.6, `anod`, `@zakkster/lite-signal`, `rescript-signals`, `@preact/signals-core`, `s-js`, `@maverick-js/signals`, `oby`, `solid-js`, `sinuous`, `mobx`, `ulive`, `usignal`, `@webreflection/*`, `nanostores`, `@tanstack/store`, `rxjs`, `observ`, `observable`).
- **Memory-safe:** `FinalizationRegistry` safety net cleans up abandoned external subscriptions when sources are garbage-collected, with isolated disposer/cancellation closures (`/*@__NOINLINE__*/`) so long-lived Observables, Promises, and Async Iterables never retain `next`/`cleanup` callbacks, and without retaining effect-owned signal graphs.
- **Interoperable:** ESM, CommonJS (`.cjs`), IIFE (`.min.js`), and UMD builds.

## Contents

- [Installation](#installation)
- [Choosing an Entry Point (`usub` vs `lite` vs `tiny`)](#choosing-an-entry-point-usub-vs-lite-vs-tiny)
- [Quickstart](#quickstart)
- [Real-World Use Cases](#real-world-use-cases)
- [API Reference](#api-reference)
- [Porting Any Signal or Store Library](#porting-any-signal-or-store-library)
- [Building a Custom Signal from Scratch](#building-a-custom-signal-from-scratch)
- [Adapter Recipes](#adapter-recipes)
- [Tested Signal and Store Adapters](#tested-signal-and-store-adapters)
- [Finalization and Memory Safety](#finalization-and-memory-safety)
- [Development](#development)
- [License](#license)

## Installation

```bash
npm install usub
# or
yarn add usub
```

Import the ESM or CommonJS entry point:

```js
// ESM
import { sub, is, get, api } from "usub";

// CommonJS
const { sub, is, get, api } = require("usub");
```

CDN builds (`unpkg`):

- **Full (`usub`):** `https://unpkg.com/usub` (ESM: `https://unpkg.com/usub?module`)
- **Lite (`usub/lite`):** `https://unpkg.com/usub/lite` (ESM: `https://unpkg.com/usub/lite?module`)
- **Tiny (`usub/tiny`):** `https://unpkg.com/usub/tiny` (ESM: `https://unpkg.com/usub/tiny?module`)

## Choosing an Entry Point (`usub` vs `lite` vs `tiny`)

All three entry points export `{ sub, is, get, api }` (with **isolated** `api` configuration per entry point):

| Capability | `usub` | `usub/lite` | `usub/tiny` |
| --- | :---: | :---: | :---: |
| Minified / Gzipped (`.min.js`) | `779 B` / `470 B` | `545 B` / `355 B` | `434 B` / `291 B` |
| Signals & Memos (`api.effect`, `api.is`, `api.get`, `api.cleanup`) | Yes | Yes | Yes |
| Custom Observables / Stores (`api.any`) | Yes | Yes | Yes |
| Functions & Nested Getters (`() => value`) | Yes | Yes | Yes |
| Promises / Thenables (`.then`) | Yes | Yes | Yes |
| Async Iterables (`[Symbol.asyncIterator]`) | Yes | Yes | — |
| TC39 / RxJS / Nanostores / TanStack (`.subscribe`, `[Symbol.observable]`) | Yes | via `api.any` | via `api.any` |
| `observ` / `observable` (`.set` + `.call`) | Yes | via `api.any` | via `api.any` |

```js
import { sub, is, get, api } from "usub";       // Full universal support
import { sub, is, get, api } from "usub/lite";  // Signals + Async Iterables + Promises
import { sub, is, get, api } from "usub/tiny";  // Signals + Promises + Functions
```

## Quickstart

`sub(target, next, error, cleanup)` subscribes to any supported reactive or async source and returns an `unsubscribe` function:

```js
import { sub, is, get } from "usub";

// 1. Promise (resolves once, then runs cleanup)
const stopPromise = sub(
	Promise.resolve("ready"),
	(value) => console.log("promise:", value),
	(err) => console.error("error:", err),
	() => console.log("promise settled")
);

// 2. Async generator / stream (cancels cleanly when stopStream() is called)
async function* counter() {
	for (let i = 1; i <= 3; i++) yield i;
}
const stopStream = sub(
	counter(),
	(n) => console.log("chunk:", n),
	console.error,
	() => console.log("stream complete")
);

// 3. Observable (.subscribe / Symbol.observable — e.g. RxJS, Nanostores, Preact Signals)
const observable = {
	subscribe(next, _error, complete) {
		next(10);
		next(20);
		complete();
		return { unsubscribe() {} };
	},
};
sub(observable, console.log, console.error, () => console.log("done"));

// 4. Check & unwrap values uniformly
console.log(is(observable));        // true
console.log(is({ plain: true }));   // false
console.log(get(() => () => 42));   // 42 (recursively unwraps functions & signals)
```

To add reactive tracking for your preferred signal library, configure `api` once at application startup:

```js
import { sub, api } from "usub";
import { signal, computed, effect, Signal } from "@preact/signals-core";

Object.assign(api, {
	is: (v) => v instanceof Signal,
	get: (v) => v.value,
	effect,
});

const count = signal(1);
const doubled = computed(() => count.value * 2);

const off = sub(doubled, (v) => console.log("doubled:", v)); // logs: 2
count.value = 5; // logs: 10
off();
count.value = 9; // ignored
```

## Real-World Use Cases

### 1. Framework-agnostic UI / Web Component bindings

Accept static values, getter functions, Promises, Async Iterables, Observables, or Signals through a single prop helper—without coupling your component library to one framework:

```js
import { is, sub } from "usub";

export function bindText(element, source) {
	if (!is(source)) {
		element.textContent = String(source ?? "");
		return () => {};
	}
	return sub(
		source,
		(value) => { element.textContent = String(value ?? ""); },
		(err) => { element.dataset.error = err.message; }
	);
}
```

### 2. Auto-canceling async fetches on reactive signal changes

When `api.effect` supports cleanup (natively via returned cleanup function or via `api.cleanup`), `usub` runs your `cleanup` callback before every re-run and on `off()`—ideal for `AbortController`, timers, or DOM listeners:

```js
import { sub, api } from "usub/lite";
import { signal, effect, Signal } from "@preact/signals-core";

Object.assign(api, {
	is: (v) => v instanceof Signal,
	get: (v) => v.value,
	effect,
});

const query = signal("usub");

const stopSearch = sub(
	query,
	(q) => {
		const controller = new AbortController();
		fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
			.then((r) => r.json())
			.then((results) => console.log("results:", results))
			.catch((err) => {
				if (err.name !== "AbortError") console.error(err);
			});

		// Store abort logic for the cleanup callback below
		query._abort = () => controller.abort();
	},
	console.error,
	() => query._abort?.() // Cancels in-flight request before next query or on stopSearch()
);

query.value = "ustor"; // Aborts "usub" request, starts "ustor" request
stopSearch();          // Aborts in-flight "ustor" request
```

### 3. Consuming streaming responses (SSE / LLM token streams) with cancellation

```js
import { sub } from "usub/lite";

async function* tokenStream(chunks, delayMs = 20) {
	for (const chunk of chunks) {
		await new Promise((r) => setTimeout(r, delayMs));
		yield chunk;
	}
}

let output = "";
const cancel = sub(
	tokenStream(["Hello", ", ", "world", "!"]),
	(token) => { output += token; },
	(err) => console.error("Stream failed:", err),
	() => console.log("Final output:", output)
);

// Call cancel() at any time (e.g. user clicks "Stop generating") to halt consumption.
```

### 4. Bridging reactive stores (`ustor`, `nanostores`, `rxjs`)

In `usub`, stores exposing `.subscribe()` (`nanostores`, `@tanstack/store`, `rxjs`, `@preact/signals-core`) work with **zero configuration**, and `ustor`'s underlying `$field` signals work directly with the same signal adapter:

```js
import { sub } from "usub";
import { atom, computed } from "nanostores";

const price = atom(25);
const qty = atom(2);
const total = computed([price, qty], (p, q) => p * q);

const off = sub(total, (value) => console.log("Cart total:", value)); // 50
qty.set(3); // Cart total: 75
off();
```

## API Reference

### `sub(target, next?, error?, cleanup?)`

Subscribes to `target` and returns an `unsubscribe` disposer function (or a falsy value if `target` is not observable or has no active teardown).

- **`target`**: Any Observable (`[Symbol.observable]` / `.subscribe`), Signal (`api.is`), custom source (`api.any`), `observ`/`observable` (`.set` + `.call`), function, Promise/thenable (`.then`), or Async Iterable (`[Symbol.asyncIterator]`). Non-observable values (`null`, `undefined`, primitives, plain objects, arrays) safely no-op without throwing.
- **`next(value)`**: Invoked with the unwrapped value (`get(v)` recursively resolves nested signals and functions).
- **`error(err)`**: Invoked when an Observable errors, a Promise rejects, or an Async Iterable throws.
- **`cleanup()`**: Invoked when an Observable completes or is unsubscribed (at most once), when a Promise resolves (unless unsubscribed beforehand), when an Async Iterable finishes, or when a Signal effect re-runs / disposes.

Dispatch precedence in `usub`:

1. `[Symbol.observable]()?.subscribe` / `target.subscribe`
2. `api.is(target) || typeof target === "function"`:
   - `observ` / `observable` (`target.set && target.length && target(emit)`)
   - `api.any?.(target)?.(next, error, cleanup)`
   - `api.effect?.(() => (emit(target), api.cleanup?.(cleanup), cleanup))`
3. `target.then` (Promise / thenable)
4. `target[Symbol.asyncIterator]` (Async Iterable)

### `is(value)`

Returns `true` if `value` is recognized as subscribable by the current entry point (`usub`, `usub/lite`, or `usub/tiny`), `false` for non-observable objects, and passes falsy primitives through (`null`, `undefined`, `0`, `false`, `""`).

### `get(value)`

Recursively unwraps signals (`api.is(v) ? get(api.get(v))`) and zero-arg functions (`typeof v === "function" ? get(v()) : v`), returning the underlying value. Non-signal, non-callable values are returned as-is.

### `api`

Mutable adapter object per entry point (`usub`, `usub/lite`, `usub/tiny`):

| Property | Default | Purpose |
| --- | --- | --- |
| `api.is(v)` | `v => v?.call` | Brand check returning truthy for signals/stores from your library. |
| `api.get(v)` | `v => v?.()` | Synchronously read the current value of a signal. |
| `api.effect(fn)` | `f => f()` | Run `fn`, auto-track signal reads, re-run on updates, and return a dispose function. Note: `fn` returns `cleanup`, which libraries like Preact Signals, Oby, `ulive`, `usignal`, `alien-signals`, and `@webreflection/*` invoke automatically. |
| `api.cleanup(fn)` | `undefined` | Optional hook for libraries with separate cleanup registration (`onCleanup` in Solid.js, `onEffectCleanup` in Vue, `S.cleanup` in S.js, `cleanup` in Sinuous). Note: `fn` is `undefined` when `sub()` is called without a 4th argument—guard with `(fn) => fn && onCleanup(fn)` if the target library requires a function. |
| `api.any(target)` | `undefined` | Universal escape hatch: `(target) => (next, error, cleanup) => unsubscribe` (return `undefined` to fall through to `api.effect`). |

## Porting Any Signal or Store Library

Configure `api` once at startup—no changes to `usub` are needed.

### Pattern 1: `.value`-based signal libraries

Used by `@preact/signals-core`, `ulive`, `usignal`, `@webreflection/signal`, `@webreflection/signals`, and `@webreflection/alien-signals`:

```js
Object.assign(api, {
	is: (v) => v instanceof Signal, // or typeof v?.peek === "function"
	get: (v) => v.value,
	effect: (fn) => effect(fn),     // fn() returns cleanup; effect() returns dispose
});
```

### Pattern 2: Callable-signal libraries (with optional root/cleanup hooks)

Used by `solid-js`, `oby`, `sinuous/observable`, `alien-signals`, and `s-js`:

```js
Object.assign(api, {
	is: (v) => isSignal(v),
	get: (v) => v(),
	// Wrap in a disposable root when the library's effect does not return a disposer directly:
	effect: (fn) => createRoot((dispose) => (createEffect(fn), dispose)),
	// Guard fn when registering with explicit cleanup hooks:
	cleanup: (fn) => fn && onCleanup(fn),
});
```

### Pattern 3: Push stores & streams via `api.any` (for `usub/lite` and `usub/tiny`)

Used for `nanostores`, `@tanstack/store`, `rxjs`, or custom pub/sub emitters in `usub/lite` and `usub/tiny`:

```js
Object.assign(api, {
	is: (v) => typeof v?.subscribe === "function" && "state" in v,
	get: (v) => v.state,
	any: (store) => (next, _error, cleanup) => {
		next?.(get(store)); // Emit initial state if desired
		const subHandle = store.subscribe(() => next?.(get(store)));
		return () => {
			subHandle.unsubscribe();
			cleanup?.();
		};
	},
});
```

## Building a Custom Signal from Scratch

You can pair `usub` (or `usub/tiny` at `291 B` gzipped) with a minimal 20-line custom signal implementation:

```js
import assert from "node:assert/strict";
import { sub, is, get, api } from "usub/tiny";

// Minimal custom Signal + Effect implementation (~20 lines)
let activeEffect = null;

class MiniSignal {
	#value;
	#subs = new Set();
	constructor(value) { this.#value = value; }
	get value() {
		if (activeEffect) this.#subs.add(activeEffect);
		return this.#value;
	}
	set value(next) {
		if (Object.is(this.#value, next)) return;
		this.#value = next;
		for (const run of [...this.#subs]) run();
	}
}

function miniEffect(fn) {
	let cleanup;
	let disposed = false;
	const run = () => {
		if (disposed) return;
		cleanup?.();
		const prev = activeEffect;
		activeEffect = run;
		try { cleanup = fn(); } finally { activeEffect = prev; }
	};
	run();
	return () => {
		if (disposed) return;
		disposed = true;
		cleanup?.();
		cleanup = undefined;
	};
}

// Plug into usub
Object.assign(api, {
	is: (v) => v instanceof MiniSignal,
	get: (v) => v.value,
	effect: miniEffect,
});

// Validate the adapter
const count = new MiniSignal(1);
const nested = new MiniSignal(count);
const log = [];

assert.equal(is(count), true);
assert.equal(get(nested), 1);

const off = sub(nested, (v) => log.push(v), null, () => log.push("clean"));
count.value = 0;     // falsy values preserved
count.value = 42;
off();
off();               // idempotent teardown
count.value = 99;    // ignored after off()

assert.deepEqual(log, [1, "clean", 0, "clean", 42, "clean"]);
```

## Adapter Recipes

### Solid.js

```js
import { sub, api } from "usub";
import { createSignal, createMemo, createEffect, createRoot, onCleanup } from "solid-js";

Object.assign(api, {
	is: (v) => Boolean(v?.name?.includes("readSignal")),
	get: (v) => v?.(),
	effect: (f) => createRoot((dispose) => (createEffect(f), dispose)),
	cleanup: (fn) => fn && onCleanup(fn),
});

const [count, setCount] = createSignal(0);
const off = sub(count, console.log);
setCount(10);
off();
```

### Preact Signals / `usignal` / `@webreflection/signal`

```js
import { sub, api } from "usub/lite";
import { signal, effect, Signal } from "@preact/signals-core"; // or "usignal" / "@webreflection/signal"

Object.assign(api, {
	is: (v) => v instanceof Signal,
	get: (v) => v.value,
	effect,
});

const count = signal(0);
const off = sub(count, console.log);
count.value = 10;
off();
```

### Vue Reactivity (`@vue/reactivity`)

```js
import { sub, api } from "usub/lite";
import { shallowRef, computed, effect, stop, onEffectCleanup, isRef } from "@vue/reactivity";

Object.assign(api, {
	is: isRef,
	get: (v) => v.value,
	effect: (f) => {
		const runner = effect(f);
		return () => stop(runner);
	},
	cleanup: onEffectCleanup,
});

const count = shallowRef(1);
const doubled = computed(() => count.value * 2);
const off = sub(doubled, console.log);
count.value = 5;
off();
```

### `alien-signals`

```js
import { sub, api } from "usub/lite";
import { signal, computed, effect, isSignal, isComputed } from "alien-signals";

Object.assign(api, {
	is: (v) => typeof v === "function" && (isSignal(v) || isComputed(v)),
	get: (v) => v(),
	effect,
});

const count = signal(1);
const off = sub(computed(() => count() * 10), console.log);
count(2);
off();
```

### Oby / Sinuous / S.js / MobX / `ulive`

```js
// Oby
import { observable, effect, isObservable } from "oby";
Object.assign(api, { is: isObservable, get: (v) => v(), effect: (f) => effect(f, { sync: true }) });

// Sinuous
import { observable, subscribe, root, cleanup } from "sinuous/observable";
Object.assign(api, {
	is: (v) => Boolean(v?.$o),
	get: (v) => v(),
	effect: (f) => root((dispose) => (subscribe(f), dispose)),
	cleanup: (fn) => fn && cleanup(fn),
});

// MobX
import { observable, computed, autorun, isBoxedObservable, isComputed } from "mobx";
Object.assign(api, {
	is: (v) => isBoxedObservable(v) || isComputed(v),
	get: (v) => v.get(),
	effect: (f) => {
		let clean;
		const off = autorun(() => { clean?.(); clean = f(); });
		return () => { off(); clean?.(); clean = null; };
	},
});

// ulive
import { signal, effect } from "ulive";
Object.assign(api, {
	is: (v) => typeof v?.peek === "function",
	get: (v) => v.value,
	effect: (f) => { let d = effect(f); return () => (d?.(), d = null); },
});

// @volynets/reflex
import { signal, computed, effect, createRuntime } from "@volynets/reflex";
createRuntime({ effectStrategy: "eager" }); // or call flush() after writes
const reflexNodes = new WeakSet();
Object.assign(api, { is: (v) => reflexNodes.has(v), get: (v) => v(), effect });

// @reactively/core
import { Reactive, stabilize } from "@reactively/core";
Object.assign(api, {
	is: (v) => v instanceof Reactive,
	get: (v) => v.get(),
	effect: (f) => {
		let clean, dead = false;
		const obs = new Reactive(() => { if (!dead) { clean?.(); clean = f(); } }, true);
		obs.get();
		return () => { if (!dead) { dead = true; clean?.(); clean = undefined; obs.set(undefined); } };
	},
});

// anod
import { Signal, Compute, c } from "anod";
let anodCtx;
Object.assign(api, {
	is: (v) => v instanceof Signal || v instanceof Compute,
	get: (v) => (anodCtx ? anodCtx.val(v) : v.get()),
	effect: (f) => {
		const fx = c.effect((ctx) => {
			const prev = anodCtx; anodCtx = ctx;
			try { f(); } finally { anodCtx = prev; }
		});
		return () => fx.dispose();
	},
	cleanup: (fn) => fn && anodCtx?.cleanup(fn),
});

// @zakkster/lite-signal (zero-config in usub via .subscribe; api setup for lite/tiny)
import { effect as liteEffect, onCleanup as liteCleanup } from "@zakkster/lite-signal";
Object.assign(api, {
	is: (v) => typeof v === "function" && typeof v.peek === "function",
	get: (v) => v(),
	effect: liteEffect,
	cleanup: (fn) => fn && liteCleanup(fn),
});

// rescript-signals
import * as RSSignal from "rescript-signals/src/signals/Signal.res.mjs";
import * as RSEffect from "rescript-signals/src/signals/Effect.res.mjs";
Object.assign(api, {
	is: (v) => Boolean(v && typeof v === "object" && typeof v.equals === "function" && v.subs),
	get: (v) => RSSignal.get(v),
	effect: (f) => { const d = RSEffect.runWithDisposer(f); return () => d.dispose(); },
});

// @maverick-js/signals
import { effect as maverickEffect, isReadSignal } from "@maverick-js/signals";
Object.assign(api, { is: isReadSignal, get: (v) => v(), effect: maverickEffect });
```

## Tested Signal and Store Adapters

All 25 libraries below (including the full top 11 from [`js-reactivity-benchmark`](https://volynetstyle.github.io/js-reactivity-benchmark/)) are continuously tested in [`test/adapters.spec.js`](./test/adapters.spec.js) and [`test/core.spec.js`](./test/core.spec.js) across `usub`, `usub/lite`, and `usub/tiny` (covering `is()`, recursive `get()`, falsy values, derived/computed memos, conditional dependency switching, nested signals, cleanup lifecycles, idempotent `off()`, and `FinalizationRegistry` GC non-retention):

| Package | `usub` (`src`) | `usub/lite` & `usub/tiny` |
| --- | --- | --- |
| `@volynets/reflex` | `api.effect` | `api.effect` |
| `alien-signals` | `api.effect` | `api.effect` |
| `@reactively/core` | `api.effect` (`new Reactive(fn, true)`) | `api.effect` (`new Reactive(fn, true)`) |
| `@vue/reactivity` (`3.5` & `3.6 RC`) | `api.effect` + `stop` + `onEffectCleanup` | `api.effect` + `stop` + `onEffectCleanup` |
| `anod` | `api.effect` (`c.effect` + `ctx.val` + `ctx.cleanup`) | `api.effect` (`c.effect` + `ctx.val` + `ctx.cleanup`) |
| `@zakkster/lite-signal` | Zero-config (`.subscribe`) or `api.effect` | `api.effect` + `onCleanup` |
| `rescript-signals` | `api.effect` (`Effect.runWithDisposer`) | `api.effect` (`Effect.runWithDisposer`) |
| `@preact/signals-core` | Zero-config (`.subscribe`) or `api.effect` | `api.effect` |
| `s-js` | `api.effect` + `S.root` + `S.cleanup` | `api.effect` + `S.root` + `S.cleanup` |
| `@maverick-js/signals` | `api.effect` | `api.effect` |
| `oby` | `api.effect` | `api.effect` |
| `solid-js` | `api.effect` + `createRoot` + `onCleanup` | `api.effect` + `createRoot` + `onCleanup` |
| `sinuous/observable` | `api.effect` + `root` + `cleanup` | `api.effect` + `root` + `cleanup` |
| `ulive` | `api.effect` | `api.effect` |
| `usignal` | `api.effect` | `api.effect` |
| `mobx` | `api.effect` (`autorun`) | `api.effect` (`autorun`) |
| `@webreflection/signal` | `api.effect` | `api.effect` |
| `@webreflection/signals` | `api.effect` | `api.effect` |
| `@webreflection/alien-signals` | `api.effect` | `api.effect` |
| `nanostores` | Zero-config (`.subscribe`) | `api.any` |
| `@tanstack/store` | Zero-config (`.subscribe`) | `api.any` |
| `rxjs` | Zero-config (`.subscribe` / `Symbol.observable`) | `api.any` |
| `observ` / `observable` | Zero-config (`.set` & `.length` + `.call`) | `api.any` |

## Finalization and Memory Safety

`usub` uses `FinalizationRegistry` carefully to prevent memory leaks without pinning reactive graphs:

- **External subscriptions** (`.subscribe`, `observ`, `api.any`, Promises, Async Iterables) are registered with `FinalizationRegistry` so if a source object becomes unreachable before `off()` is called, its teardown still runs automatically.
- **Isolated disposer & cancellation scopes:** Both the observable disposer (`off(s, c)` in `usub`) and the promise / async-iterator cancellation closure (`cancel(stop)` across `usub`, `usub/lite`, and `usub/tiny`) are module-level helpers marked `/*@__NOINLINE__*/` so `FinalizationRegistry`-held functions never capture `sub()`'s lexical context or retain `next`/`cleanup` callbacks while long-lived sources remain reachable.
- **Effect-owned signal subscriptions** (`api.effect`) are **never** parked in `FinalizationRegistry`, because an effect disposer references the effect's dependency nodes (which reach back to the signal) and would otherwise prevent garbage collection. Always call the returned `off()` disposer when tearing down long-lived signal subscriptions, or create them inside your framework's owner/scope lifecycle.

## Development

```bash
npm run build          # Build ESM, CJS, UMD, and minified IIFE bundles for usub, lite, and tiny
npm test               # Build and run the full Vitest suite (including V8 --expose-gc finalization checks)
npm run test:watch     # Run Vitest in interactive watch mode
npm run test:coverage  # Enforce 100% statement, branch, function, and line coverage across src, lite, and tiny
```

## License

MIT

## Thanks and Inspiration

- **[dy](https://github.com/dy)**

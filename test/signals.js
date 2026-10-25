import t, { is, ok } from 'tst'
import { api, sub, is as isObs, get } from '../src/index.js'
import { api as liteApi, sub as liteSub, is as liteIs, get as liteGet } from '../lite/index.js'
import { api as tinyApi, sub as tinySub, is as tinyIs, get as tinyGet } from '../tiny/index.js'

import { Signal as PreactSignal, computed as preactComputed, effect as preactEffect, signal as preactSignal } from '@preact/signals-core'
import {
  createEffect as solidEffect,
  createMemo as solidMemo,
  createRoot as solidRoot,
  createSignal as solidSignal,
  onCleanup as solidCleanup,
} from 'solid-js/dist/solid.js'
import {
  effect as obyEffect,
  isObservable as isObyObservable,
  memo as obyMemo,
  observable as obySignal,
} from 'oby'
import {
  cleanup as sinuousCleanup,
  computed as sinuousComputed,
  observable as sinuousSignal,
  root as sinuousRoot,
  subscribe as sinuousSubscribe,
} from 'sinuous/observable'
import { computed as uliveComputed, effect as uliveEffect, signal as uliveSignal } from 'ulive'
import { Signal as USignal, computed as uSignalComputed, effect as uSignalEffect, signal as uSignal } from 'usignal'
import {
  computed as vueComputed,
  effect as vueEffect,
  effectScope as vueEffectScope,
  isRef as isVueRef,
  onEffectCleanup as vueCleanup,
  shallowRef as vueSignal,
  stop as vueStop,
} from '@vue/reactivity'
import {
  computed as alienComputed,
  effect as alienEffect,
  isComputed as isAlienComputed,
  isSignal as isAlienSignal,
  signal as alienSignal,
} from 'alien-signals'
import S from 's-js'
import {
  autorun as mobxAutorun,
  computed as mobxComputed,
  isBoxedObservable as isMobxBox,
  isComputed as isMobxComputed,
  observable as mobxObservable,
  runInAction as mobxAction,
} from 'mobx'
import { BehaviorSubject, Subject } from 'rxjs'
import { atom as nanoAtom, computed as nanoComputed } from 'nanostores'
import {
  ReadonlyStore as TanStackReadonlyStore,
  Store as TanStackStore,
  createStore as createTanStackStore,
} from '@tanstack/store'
import { Signal as WRSignal, computed as wrSignalComputed, effect as wrSignalEffect, signal as wrSignal } from '@webreflection/signal'
import { Signal as WRSignals, computed as wrSignalsComputed, effect as wrSignalsEffect, signal as wrSignals } from '@webreflection/signals'
import {
  Signal as WRAlienSignal,
  computed as wrAlienComputed,
  effect as wrAlienEffect,
  signal as wrAlienSignal,
} from '@webreflection/alien-signals'

const variants = [
  { name: 'src', api, sub, is: isObs, get },
  { name: 'lite', api: liteApi, sub: liteSub, is: liteIs, get: liteGet },
  { name: 'tiny', api: tinyApi, sub: tinySub, is: tinyIs, get: tinyGet },
]

const sSignals = new WeakSet()
let solidDisposers = []

const onceDispose = (effectFn) => (f) => {
  let d = effectFn(f)
  return () => {
    d?.()
    d = null
  }
}

/**
 * 13 effect-driven signal libraries matching the `ustor` adapter suite.
 * Each entry defines:
 * - `usubApi`: `{ is, get, effect, cleanup? }` configuration for `usub`
 * - `create(v)`: creates a writable signal (returning `{ target, set }`)
 * - `memo(fn)`: creates a derived/computed signal target
 * - `hasNativeSubscribe`: true when signals define `.subscribe()` directly (Preact Signals in `src`)
 * - `eagerInvalidation`: true when `computed` push-notifies on first stale-dep flush before lazy pruning (`@webreflection/signals`)
 * - `scope(fn)`: optional owner/disposal scope for memos (Solid, Sinuous, Vue, S.js)
 */
const signalAdapters = [
  {
    name: '@preact/signals-core',
    hasNativeSubscribe: true,
    usubApi: {
      is: (v) => v instanceof PreactSignal,
      get: (v) => v.value,
      effect: preactEffect,
    },
    create: (initial) => {
      const s = preactSignal(initial)
      return { target: s, set: (v) => { s.value = v } }
    },
    memo: (fn) => preactComputed(fn),
  },
  {
    name: 'solid-js',
    usubApi: {
      is: (v) => Boolean(v?.name?.includes('readSignal')),
      get: (v) => v?.(),
      effect: (f) => solidRoot((dispose) => (solidEffect(f), dispose)),
      cleanup: (fn) => fn && solidCleanup(fn),
    },
    create: (initial) => {
      const [read, write] = solidSignal(initial)
      return { target: read, set: (v) => write(typeof v === 'function' ? () => v : v) }
    },
    // Create each memo in its own disposable root so top-level `set()` flushes synchronously
    memo: (fn) => solidRoot((dispose) => {
      solidDisposers.push(dispose)
      return solidMemo(fn)
    }),
    scope: (fn) => {
      solidDisposers = []
      try {
        return fn()
      } finally {
        for (const d of solidDisposers.splice(0)) d()
      }
    },
  },
  {
    name: 'oby',
    usubApi: {
      is: isObyObservable,
      get: (v) => v(),
      // `oby.effect` natively invokes a cleanup function returned by `f()`
      effect: (f) => obyEffect(f, { sync: true }),
    },
    create: (initial) => {
      const s = obySignal(initial)
      return { target: s, set: (v) => s(typeof v === 'function' ? () => v : v) }
    },
    memo: (fn) => obyMemo(fn),
  },
  {
    name: 'sinuous/observable',
    usubApi: {
      is: (v) => Boolean(v?.$o),
      get: (v) => v(),
      effect: (f) => sinuousRoot((dispose) => (sinuousSubscribe(f), dispose)),
      cleanup: (fn) => fn && sinuousCleanup(fn),
    },
    create: (initial) => {
      const s = sinuousSignal(initial)
      return { target: s, set: (v) => s(v) }
    },
    memo: (fn) => sinuousComputed(fn),
    scope: (fn) => sinuousRoot((dispose) => {
      try { return fn() } finally { dispose() }
    }),
  },
  {
    name: 'ulive',
    usubApi: {
      is: (v) => typeof v?.peek === 'function',
      get: (v) => v.value,
      effect: onceDispose(uliveEffect),
    },
    create: (initial) => {
      const s = uliveSignal(initial)
      return { target: s, set: (v) => { s.value = v } }
    },
    memo: (fn) => uliveComputed(fn),
  },
  {
    name: 'usignal',
    usubApi: {
      is: (v) => v instanceof USignal,
      get: (v) => v.value,
      effect: uSignalEffect,
    },
    create: (initial) => {
      const s = uSignal(initial)
      return { target: s, set: (v) => { s.value = v } }
    },
    memo: (fn) => uSignalComputed(fn),
  },
  {
    name: '@vue/reactivity',
    usubApi: {
      is: isVueRef,
      get: (v) => v.value,
      effect: (f) => {
        const runner = vueEffect(f)
        return () => vueStop(runner)
      },
      cleanup: vueCleanup,
    },
    create: (initial) => {
      const s = vueSignal(initial)
      return { target: s, set: (v) => { s.value = v } }
    },
    memo: (fn) => vueComputed(fn),
    scope: (fn) => {
      const scope = vueEffectScope()
      try { return scope.run(fn) } finally { scope.stop() }
    },
  },
  {
    name: 'alien-signals',
    usubApi: {
      is: (v) => typeof v === 'function' && (isAlienSignal(v) || isAlienComputed(v)),
      get: (v) => v(),
      effect: alienEffect,
    },
    create: (initial) => {
      const s = alienSignal(initial)
      return { target: s, set: (v) => s(v) }
    },
    memo: (fn) => alienComputed(fn),
  },
  {
    name: 's-js',
    usubApi: {
      is: (v) => sSignals.has(v),
      get: (v) => v(),
      effect: (f) => S.root((dispose) => (S(f), dispose)),
      cleanup: (fn) => fn && S.cleanup(fn),
    },
    create: (initial) => {
      const s = S.data(initial)
      sSignals.add(s)
      return { target: s, set: (v) => s(v) }
    },
    memo: (fn) => {
      const m = S(fn)
      sSignals.add(m)
      return m
    },
    scope: (fn) => S.root((dispose) => {
      try { return fn() } finally { dispose() }
    }),
  },
  {
    name: 'mobx',
    usubApi: {
      is: (v) => isMobxBox(v) || isMobxComputed(v),
      get: (v) => v.get(),
      effect: (f) => {
        let clean
        const off = mobxAutorun(() => {
          clean?.()
          clean = f()
        })
        return () => {
          off()
          clean?.()
          clean = null
        }
      },
    },
    create: (initial) => {
      const box = mobxObservable.box(initial, { deep: false })
      return { target: box, set: (v) => mobxAction(() => box.set(v)) }
    },
    memo: (fn) => mobxComputed(fn),
  },
  {
    name: '@webreflection/signal',
    usubApi: {
      is: (v) => v instanceof WRSignal,
      get: (v) => v.value,
      effect: onceDispose(wrSignalEffect),
    },
    create: (initial) => {
      const s = wrSignal(initial)
      return { target: s, set: (v) => { s.value = v } }
    },
    memo: (fn) => wrSignalComputed(fn),
  },
  {
    name: '@webreflection/signals',
    eagerInvalidation: true,
    usubApi: {
      is: (v) => v instanceof WRSignals,
      get: (v) => v.value,
      effect: wrSignalsEffect,
    },
    create: (initial) => {
      const s = wrSignals(initial)
      return { target: s, set: (v) => { s.value = v } }
    },
    memo: (fn) => wrSignalsComputed(fn),
  },
  {
    name: '@webreflection/alien-signals',
    usubApi: {
      is: (v) => v instanceof WRAlienSignal,
      get: (v) => v.value,
      effect: wrAlienEffect,
    },
    create: (initial) => {
      const s = wrAlienSignal(initial)
      return { target: s, set: (v) => { s.value = v } }
    },
    memo: (fn) => wrAlienComputed(fn),
  },
]

export function registerSignalAdapterTests({ tick, gc, resetAllApis }) {
  // =========================================================================
  // 1. All 13 effect-driven signal adapters across `src`, `lite`, and `tiny`
  // =========================================================================
  for (const lib of signalAdapters) {
    t(`signal adapter [${lib.name}]: is/get, falsy values, memos, nested signals, cleanup & GC across src/lite/tiny`, async () => {
      const runScoped = (fn) => (lib.scope ? lib.scope(fn) : fn())

      for (const v of variants) {
        resetAllApis()
        Object.assign(v.api, lib.usubApi)

        runScoped(() => {
          // 1a. `is()` brand detection & `get()` recursive unwrapping
          const { target: s0 } = lib.create(0)
          const { target: sNested } = lib.create(lib.create('deep').target)
          const m0 = lib.memo(() => v.get(s0) + 5)

          is(v.is(s0), true, `${lib.name} (${v.name}): is(signal) === true`)
          is(v.is(m0), true, `${lib.name} (${v.name}): is(memo) === true`)
          is(v.is({ plain: 1 }), false, `${lib.name} (${v.name}): is(plainObject) === false`)
          is(v.get(s0), 0, `${lib.name} (${v.name}): get(signal(0)) === 0`)
          is(v.get(m0), 5, `${lib.name} (${v.name}): get(memo) === 5`)
          is(v.get(sNested), 'deep', `${lib.name} (${v.name}): get(nested signal) === 'deep'`)

          // 1b. Writable signal reactivity, falsy values, no-cleanup subscription, and idempotent off()
          const { target: sig, set } = lib.create(1)
          const values = []
          const offNoClean = v.sub(sig, (val) => values.push(val))
          is(typeof offNoClean, 'function', `${lib.name} (${v.name}): sub() returns dispose fn`)
          set(0)
          set(false)
          set('')
          set(null)
          set(undefined)
          set(42)
          offNoClean()
          offNoClean()
          set(99)
          is(
            values,
            [1, 0, false, '', null, undefined, 42],
            `${lib.name} (${v.name}): tracks initial + falsy + updated values and stops on off()`
          )

          // 1c. Cleanup lifecycle
          const { target: cSig, set: cSet } = lib.create('a')
          const lifecycle = []
          const offClean = v.sub(
            cSig,
            (val) => lifecycle.push(`next:${val}`),
            null,
            () => lifecycle.push('clean')
          )
          cSet('b')
          offClean()
          offClean()
          cSet('c')

          // In `src`, Preact Signals uses native `.subscribe()` (cleanup once on teardown);
          // all effect-driven subscriptions run cleanup before each re-run and on teardown.
          const usesNativeSub = lib.hasNativeSubscribe && v.name === 'src'
          is(
            lifecycle,
            usesNativeSub
              ? ['next:a', 'next:b', 'clean']
              : ['next:a', 'clean', 'next:b', 'clean'],
            `${lib.name} (${v.name}): cleanup lifecycle`
          )

          // 1d. Computed / memo subscription with conditional dependency switching (ustor pattern)
          const { target: chooseLeft, set: setChooseLeft } = lib.create(true)
          const { target: left, set: setLeft } = lib.create(10)
          const { target: right, set: setRight } = lib.create(20)
          const selected = lib.memo(() => (v.get(chooseLeft) ? v.get(left) : v.get(right)))

          const memoEvents = []
          const offMemo = v.sub(selected, (val) => memoEvents.push(val))
          is(memoEvents, [10], `${lib.name} (${v.name}): initial conditional memo value`)

          setChooseLeft(false)
          is(memoEvents, [10, 20], `${lib.name} (${v.name}): memo switches to right branch`)

          setLeft(30) // inactive branch: memo value remains 20
          is(v.get(selected), 20, `${lib.name} (${v.name}): inactive branch leaves memo value at 20`)
          if (lib.eagerInvalidation) {
            // `@webreflection/signals` lazily prunes old subscriber sets on first notify, then stays silent
            is(memoEvents, [10, 20, 20], `${lib.name} (${v.name}): lazy prune re-reads current value 20`)
            setLeft(35)
            is(memoEvents, [10, 20, 20], `${lib.name} (${v.name}): pruned inactive branch no longer notifies`)
          } else {
            is(memoEvents, [10, 20], `${lib.name} (${v.name}): inactive branch update does not emit`)
          }

          const beforeRight = [...memoEvents]
          setRight(40) // active branch: emits 40
          is(memoEvents, [...beforeRight, 40], `${lib.name} (${v.name}): active branch update emits immediately`)

          offMemo()
          setRight(50)
          is(memoEvents, [...beforeRight, 40], `${lib.name} (${v.name}): off() stops memo subscription`)

          // 1e. Nested signals (`signal(innerSignal)` and `signal(() => value)`)
          const { target: inner1, set: setInner1 } = lib.create(100)
          const { target: inner2 } = lib.create(200)
          const { target: outer, set: setOuter } = lib.create(inner1)
          const nestedEvents = []
          const offNested = v.sub(outer, (val) => nestedEvents.push(val))
          is(nestedEvents, [100], `${lib.name} (${v.name}): unwraps nested signal initially`)

          if (!usesNativeSub) {
            // Effect-driven subscriptions track inner signal reads inside `get(outer)`
            setInner1(150)
            is(nestedEvents, [100, 150], `${lib.name} (${v.name}): tracks inner signal mutation`)
          }

          const prevSnapshot = [...nestedEvents]
          setOuter(inner2)
          is(nestedEvents, [...prevSnapshot, 200], `${lib.name} (${v.name}): unwraps replaced inner signal`)

          setOuter(() => 300)
          is(nestedEvents, [...prevSnapshot, 200, 300], `${lib.name} (${v.name}): unwraps function stored in signal`)
          offNested()
        })

        // 1f. GC check: disposed signal + subscription must not be retained by FinalizationRegistry
        const weakTarget = (() => {
          let holder
          runScoped(() => {
            const { target, set } = lib.create(1)
            const seen = []
            const off = v.sub(target, (x) => seen.push(x))
            set(2)
            off()
            holder = new WeakRef(target)
          })
          return holder
        })()

        await gc()
        is(weakTarget.deref(), undefined, `${lib.name} (${v.name}): disposed signal is garbage-collected`)
      }

      resetAllApis()
    })
  }

  // =========================================================================
  // 2. Store & Observable adapters from `ustor`: Nanostores, TanStack Store, RxJS, Oby async tick
  // =========================================================================
  t('store & stream adapters [nanostores, @tanstack/store, rxjs, oby async]: zero-config src + api.any lite/tiny', async () => {
    resetAllApis()

    // 2a. Nanostores: zero-config in `src` (via `.subscribe`) for both `atom` and `computed`
    {
      const count = nanoAtom(1)
      const doubled = nanoComputed(count, (n) => n * 2)
      const atomLog = []
      const compLog = []

      is(isObs(count), true, 'nanostores: src is(atom) === true without api config')
      is(isObs(doubled), true, 'nanostores: src is(computed) === true without api config')

      const offAtom = sub(count, (x) => atomLog.push(x), null, () => atomLog.push('atom-clean'))
      const offComp = sub(doubled, (x) => compLog.push(x), null, () => compLog.push('comp-clean'))

      count.set(0)
      count.set(5)
      offAtom()
      offAtom()
      offComp()
      count.set(10)

      is(atomLog, [1, 0, 5, 'atom-clean'], 'nanostores: zero-config atom in src')
      is(compLog, [2, 0, 10, 'comp-clean'], 'nanostores: zero-config computed in src')
    }

    // 2b. Nanostores in `lite` and `tiny` via `api.any`
    for (const v of [variants[1], variants[2]]) {
      resetAllApis()
      v.api.is = (x) => typeof x?.get === 'function' && typeof x?.listen === 'function'
      v.api.get = (x) => x.get()
      v.api.any = (store) => (next, _err, cleanup) => {
        const unbind = store.subscribe((val) => next?.(v.get(val)))
        return () => {
          unbind()
          cleanup?.()
        }
      }

      const base = nanoAtom(3)
      const derived = nanoComputed(base, (n) => n + 10)
      const nested = nanoAtom(base)
      const events = []
      const nestedEvents = []

      is(v.is(base), true, `nanostores (${v.name}): is(atom) === true`)
      is(v.get(nested), 3, `nanostores (${v.name}): get(nested atom) === 3`)

      const off1 = v.sub(derived, (x) => events.push(x), null, () => events.push('clean'))
      const off2 = v.sub(nested, (x) => nestedEvents.push(x))
      base.set(7)
      nested.set(nanoAtom(99))
      off1()
      off2()
      base.set(20)

      is(events, [13, 17, 'clean'], `nanostores (${v.name}): computed subscription + cleanup via api.any`)
      is(nestedEvents, [3, 99], `nanostores (${v.name}): nested atom unwrapping via api.any`)
    }
    resetAllApis()

    // 2c. TanStack Store: zero-config in `src` (via `.subscribe`) for `Store` and computed `createStore`
    {
      const state = new TanStackStore(10)
      const derived = createTanStackStore(() => state.state * 3)
      const stateEvents = []
      const derivedEvents = []

      is(isObs(state), true, '@tanstack/store: src is(Store) === true without api config')
      is(isObs(derived), true, '@tanstack/store: src is(createStore) === true without api config')

      const offState = sub(state, (x) => stateEvents.push(x), null, () => stateEvents.push('clean'))
      const offDerived = sub(derived, (x) => derivedEvents.push(x), null, () => derivedEvents.push('derived-clean'))

      state.setState(() => 0)
      state.setState(() => 4)
      offState()
      offState()
      offDerived()
      state.setState(() => 9)

      is(stateEvents, [0, 4, 'clean'], '@tanstack/store: zero-config Store updates + cleanup in src')
      is(derivedEvents, [0, 12, 'derived-clean'], '@tanstack/store: zero-config computed createStore in src')
    }

    // 2d. TanStack Store in `lite` and `tiny` via `api.any` (emitting initial state + updates)
    for (const v of [variants[1], variants[2]]) {
      resetAllApis()
      const isTS = (x) => x instanceof TanStackStore || x instanceof TanStackReadonlyStore
      v.api.is = isTS
      v.api.get = (x) => x.state
      v.api.any = (store) => (next, _err, cleanup) => {
        next?.(v.get(store))
        const subHandle = store.subscribe(() => next?.(v.get(store)))
        return () => {
          subHandle.unsubscribe()
          cleanup?.()
        }
      }

      const count = new TanStackStore(2)
      const triple = createTanStackStore(() => count.state * 3)
      const log = []
      const off = v.sub(triple, (x) => log.push(x), null, () => log.push('clean'))
      count.setState(() => 5)
      count.setState(() => 0)
      off()
      count.setState(() => 8)

      is(log, [6, 15, 0, 'clean'], `@tanstack/store (${v.name}): initial + reactive computed updates + cleanup`)
    }
    resetAllApis()

    // 2e. RxJS `BehaviorSubject` & `Subject` across `src` (native) and `lite`/`tiny` (`api.any`)
    {
      const bs = new BehaviorSubject(10)
      const srcLog = []
      const offSrc = sub(bs, (x) => srcLog.push(x), null, () => srcLog.push('done'))
      bs.next(20)
      bs.complete()
      offSrc()
      is(srcLog, [10, 20, 'done'], 'rxjs BehaviorSubject: zero-config in src runs cleanup once on complete + off')
    }
    for (const v of [variants[1], variants[2]]) {
      resetAllApis()
      v.api.is = (x) => typeof x?.subscribe === 'function'
      v.api.get = (x) => (typeof x.getValue === 'function' ? x.getValue() : x)
      v.api.any = (obs) => (next, error, cleanup) => {
        let done = false
        const s = obs.subscribe({
          next: (val) => next?.(v.get(val)),
          error,
          complete: () => {
            if (!done) {
              done = true
              cleanup?.()
            }
          },
        })
        return () => {
          s.unsubscribe()
          if (!done) {
            done = true
            cleanup?.()
          }
        }
      }

      const bs = new BehaviorSubject('init')
      const subj = new Subject()
      const bsLog = []
      const subjLog = []

      const offBs = v.sub(bs, (x) => bsLog.push(x), null, () => bsLog.push('bs-clean'))
      const offSubj = v.sub(subj, (x) => subjLog.push(x), (e) => subjLog.push(`err:${e}`), () => subjLog.push('subj-clean'))

      bs.next('next')
      offBs()
      bs.next('ignored')

      subj.next(1)
      subj.complete()
      offSubj()

      is(bsLog, ['init', 'next', 'bs-clean'], `rxjs BehaviorSubject (${v.name}): via api.any`)
      is(subjLog, [1, 'subj-clean'], `rxjs Subject (${v.name}): complete + off runs cleanup once`)
    }
    resetAllApis()

    // 2f. `ulive` `.then` non-hijack check + `oby` default microtask-batched effect check
    {
      // Verify `ulive` signal's `.then` method never hijacks reactive updates into one-shot Promise `.then`
      for (const v of variants) {
        resetAllApis()
        v.api.is = (x) => typeof x?.peek === 'function'
        v.api.get = (x) => x.value
        v.api.effect = onceDispose(uliveEffect)

        const s = uliveSignal(1)
        ok(typeof s.then === 'function', 'ulive signal defines a .then method')
        const log = []
        const off = v.sub(s, (x) => log.push(x))
        s.value = 2
        s.value = 3
        off()
        s.value = 4
        is(log, [1, 2, 3], `ulive (${v.name}): api.is takes precedence over .then for multi-update reactivity`)
      }
      resetAllApis()

      // Verify `oby` default scheduled `effect(f)` (without `{ sync: true }`) works across microtask ticks
      for (const v of variants) {
        resetAllApis()
        v.api.is = isObyObservable
        v.api.get = (x) => x()
        v.api.effect = obyEffect

        const s = obySignal('t0')
        const log = []
        const off = v.sub(s, (x) => log.push(x), null, () => log.push('clean'))
        await tick(4)
        s('t1')
        await tick(4)
        off()
        s('t2')
        await tick(4)
        is(log, ['t0', 'clean', 't1', 'clean'], `oby scheduled effect (${v.name}): emits across ticks & cleans up`)
      }
      resetAllApis()
    }
  })
}

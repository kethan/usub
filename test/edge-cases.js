import t, { is, ok, throws } from 'tst'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { sub, api, is as srcIs, get } from '../src/index.js'
import { sub as liteSub, api as liteApi, is as liteIs, get as liteGet } from '../lite/index.js'
import { sub as tinySub, api as tinyApi, is as tinyIs, get as tinyGet } from '../tiny/index.js'
import { resolve as httpsResolve, load as httpsLoad } from './https-loader.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

const variants = [
  { name: 'src', sub, api, is: srcIs, get, hasSubscribe: true, hasObserv: true, hasAsyncIter: true },
  { name: 'lite', sub: liteSub, api: liteApi, is: liteIs, get: liteGet, hasSubscribe: false, hasObserv: false, hasAsyncIter: true },
  { name: 'tiny', sub: tinySub, api: tinyApi, is: tinyIs, get: tinyGet, hasSubscribe: false, hasObserv: false, hasAsyncIter: false },
]

export function registerEdgeCaseTests({ time, tick, gc, resetAllApis }) {

  // =========================================================================
  // 1. Default `api` object shape & default method behavior across all builds
  // =========================================================================
  t('api defaults: effect, is, get, cleanup, any across src/lite/tiny', () => {
    resetAllApis()
    for (const v of variants) {
      is(typeof v.api.effect, 'function', `${v.name}: api.effect is function`)
      is(typeof v.api.is, 'function', `${v.name}: api.is is function`)
      is(typeof v.api.get, 'function', `${v.name}: api.get is function`)
      is(v.api.any, undefined, `${v.name}: api.any defaults to undefined`)
      is(v.api.cleanup, undefined, `${v.name}: api.cleanup defaults to undefined`)

      // Default effect executes synchronously and returns callback's result
      let called = 0
      const res = v.api.effect(() => (++called, 'disposer-token'))
      is(called, 1, `${v.name}: default api.effect invokes callback once`)
      is(res, 'disposer-token', `${v.name}: default api.effect returns callback result`)

      // Default api.is checks callable (`v?.call`)
      ok(v.api.is(() => {}), `${v.name}: api.is(() => {}) truthy`)
      ok(v.api.is(function named() {}), `${v.name}: api.is(function) truthy`)
      ok(v.api.is(async () => {}), `${v.name}: api.is(async fn) truthy`)
      ok(v.api.is(class C {}), `${v.name}: api.is(class) truthy`)
      is(v.api.is(null), undefined, `${v.name}: api.is(null) undefined`)
      is(v.api.is(undefined), undefined, `${v.name}: api.is(undefined) undefined`)
      is(v.api.is(0), undefined, `${v.name}: api.is(0) undefined`)
      is(v.api.is('str'), undefined, `${v.name}: api.is('str') undefined`)
      is(v.api.is({}), undefined, `${v.name}: api.is({}) undefined`)
      is(v.api.is(Object.create(null)), undefined, `${v.name}: api.is(null-proto) undefined`)

      // Default api.get invokes function or safely returns undefined for nullish
      is(v.api.get(() => 42), 42, `${v.name}: api.get(() => 42) === 42`)
      is(v.api.get(null), undefined, `${v.name}: api.get(null) === undefined`)
      is(v.api.get(undefined), undefined, `${v.name}: api.get(undefined) === undefined`)
      throws(() => v.api.get({}), TypeError, `${v.name}: api.get({}) throws TypeError`)
    }
  })

  // =========================================================================
  // 2. `get(v)` — primitives, references, nested functions, signals, errors
  // =========================================================================
  t('get(): primitives, falsy values, objects, nested functions, and hybrid signals', () => {
    resetAllApis()
    const sym = Symbol('sym')
    const obj = { a: 1 }
    const nullProto = Object.create(null)
    const arr = [1, 2, 3]
    const date = new Date(0)
    const regex = /abc/gi
    const map = new Map([['k', 'v']])
    const set = new Set([1])
    const prom = Promise.resolve(99)

    for (const v of variants) {
      // Primitives & falsy edge cases
      is(v.get(0), 0, `${v.name}: get(0)`)
      is(v.get(-0), -0, `${v.name}: get(-0)`)
      is(v.get(42), 42, `${v.name}: get(42)`)
      is(v.get(Infinity), Infinity, `${v.name}: get(Infinity)`)
      is(v.get(NaN), NaN, `${v.name}: get(NaN)`)
      is(v.get(''), '', `${v.name}: get('')`)
      is(v.get('hello'), 'hello', `${v.name}: get('hello')`)
      is(v.get(false), false, `${v.name}: get(false)`)
      is(v.get(true), true, `${v.name}: get(true)`)
      is(v.get(null), null, `${v.name}: get(null)`)
      is(v.get(undefined), undefined, `${v.name}: get(undefined)`)
      is(v.get(0n), 0n, `${v.name}: get(0n)`)
      is(v.get(123n), 123n, `${v.name}: get(123n)`)
      is(v.get(sym), sym, `${v.name}: get(Symbol)`)

      // Non-callable objects preserve identity (including Promises — get() is sync)
      ok(v.get(obj) === obj, `${v.name}: get(plain object) identity`)
      ok(v.get(nullProto) === nullProto, `${v.name}: get(Object.create(null)) identity`)
      ok(v.get(arr) === arr, `${v.name}: get(array) identity`)
      ok(v.get(date) === date, `${v.name}: get(Date) identity`)
      ok(v.get(regex) === regex, `${v.name}: get(RegExp) identity`)
      ok(v.get(map) === map, `${v.name}: get(Map) identity`)
      ok(v.get(set) === set, `${v.name}: get(Set) identity`)
      ok(v.get(prom) === prom, `${v.name}: get(Promise) returns Promise without awaiting`)

      // Single & deeply nested functions returning truthy & falsy values
      is(v.get(() => 99), 99, `${v.name}: get(() => 99)`)
      is(v.get(() => 0), 0, `${v.name}: get(() => 0)`)
      is(v.get(() => false), false, `${v.name}: get(() => false)`)
      is(v.get(() => ''), '', `${v.name}: get(() => '')`)
      is(v.get(() => null), null, `${v.name}: get(() => null)`)
      is(v.get(() => undefined), undefined, `${v.name}: get(() => undefined)`)
      is(v.get(() => NaN), NaN, `${v.name}: get(() => NaN)`)
      is(v.get((x = 7) => x), 7, `${v.name}: get(fn with default param)`)
      is(v.get(() => () => () => () => 'deep'), 'deep', `${v.name}: get(4-deep nested fn)`)

      // Custom signal unwrapping + `v?.call ? get(v()) : v` branch
      const box = (val) => ({ __sig: true, val })
      v.api.is = (x) => Boolean(x && x.__sig)
      v.api.get = (x) => x.val

      is(v.get(box(10)), 10, `${v.name}: get(signal)`)
      is(v.get(box(0)), 0, `${v.name}: get(signal(0))`)
      is(v.get(box(null)), null, `${v.name}: get(signal(null))`)
      is(v.get(box(box(box('nested-sig')))), 'nested-sig', `${v.name}: get(nested signals)`)
      // Plain function when api.is returns false -> hits `: v?.call ? get(v()) : v`
      is(v.get(() => 'plain-fn'), 'plain-fn', `${v.name}: get(fn) via v?.call fallback`)
      is(v.get(() => () => 'double-fn'), 'double-fn', `${v.name}: get(nested fn) via v?.call fallback`)
      // Hybrid alternating signal <-> function chains
      is(v.get(() => box(55)), 55, `${v.name}: get(() => signal(55))`)
      is(v.get(box(() => 66)), 66, `${v.name}: get(signal(() => 66))`)
      is(v.get(() => box(() => box(() => 'alternating'))), 'alternating', `${v.name}: get(alternating fn/signal)`)

      // Error edge cases in get()
      throws(() => v.get(class Klass {}), TypeError, `${v.name}: get(class) throws TypeError`)
      throws(() => v.get({ call: true }), TypeError, `${v.name}: get({ call: true }) throws TypeError`)
      const selfRef = () => selfRef
      throws(() => v.get(selfRef), RangeError, `${v.name}: cyclic getter throws RangeError`)
      throws(
        () => v.get({ __sig: true, get val() { throw new Error('boom-get') } }),
        /boom-get/,
        `${v.name}: throwing signal getter propagates error`
      )
    }
    resetAllApis()
  })

  // =========================================================================
  // 3. `is(arg)` — complete protocol matrix & falsy/non-observable edge cases
  // =========================================================================
  t('is(): falsy passthrough, non-observables, and src/lite/tiny feature matrix', () => {
    resetAllApis()

    for (const v of variants) {
      // Falsy inputs short-circuit `arg && !!(...)` and return the input itself
      is(v.is(undefined), undefined, `${v.name}: is(undefined) === undefined`)
      is(v.is(null), null, `${v.name}: is(null) === null`)
      is(v.is(false), false, `${v.name}: is(false) === false`)
      is(v.is(0), 0, `${v.name}: is(0) === 0`)
      is(v.is(-0), -0, `${v.name}: is(-0) === -0`)
      is(v.is(NaN), NaN, `${v.name}: is(NaN) is NaN`)
      is(v.is(''), '', `${v.name}: is('') === ''`)
      is(v.is(0n), 0n, `${v.name}: is(0n) === 0n`)

      // Truthy non-observables strictly return boolean `false`
      is(v.is(true), false, `${v.name}: is(true) === false`)
      is(v.is(1), false, `${v.name}: is(1) === false`)
      is(v.is(-99), false, `${v.name}: is(-99) === false`)
      is(v.is(Infinity), false, `${v.name}: is(Infinity) === false`)
      is(v.is('hello'), false, `${v.name}: is('hello') === false`)
      is(v.is(1n), false, `${v.name}: is(1n) === false`)
      is(v.is(Symbol('x')), false, `${v.name}: is(Symbol) === false`)
      is(v.is({}), false, `${v.name}: is({}) === false`)
      is(v.is(Object.create(null)), false, `${v.name}: is(Object.create(null)) === false`)
      is(v.is([1, 2, 3]), false, `${v.name}: is(Array) === false`)
      is(v.is(new Set([1])), false, `${v.name}: is(Set) === false`)
      is(v.is(new Map()), false, `${v.name}: is(Map) === false despite .set`)
      is(v.is(new WeakMap()), false, `${v.name}: is(WeakMap) === false despite .set`)
      is(v.is({ set() {} }), false, `${v.name}: is({ set() {} }) === false without .call`)
      is(v.is((function* () { yield 1 })()), false, `${v.name}: is(sync Generator) === false`)

      // Protocol matrix across src, lite, tiny
      const symObs = { [Symbol.observable]: () => ({ subscribe() {} }) }
      const subObj = { subscribe() {} }
      const observFn = Object.assign(() => {}, { set() {} })
      const asyncIterObj = { [Symbol.asyncIterator]: async function* () {} }
      const asyncGen = (async function* () {})()
      const realPromise = Promise.resolve(1)
      const thenable = { then() {} }
      const plainFn = () => {}

      is(v.is(symObs), v.hasSubscribe, `${v.name}: is([Symbol.observable])`)
      is(v.is(subObj), v.hasSubscribe, `${v.name}: is({ subscribe })`)
      is(v.is(observFn), true, `${v.name}: is(observ fn)`)
      is(v.is(asyncIterObj), v.hasAsyncIter, `${v.name}: is([Symbol.asyncIterator])`)
      is(v.is(asyncGen), v.hasAsyncIter, `${v.name}: is(AsyncGenerator)`)
      is(v.is(realPromise), true, `${v.name}: is(Promise)`)
      is(v.is(thenable), true, `${v.name}: is(thenable)`)
      is(v.is(plainFn), true, `${v.name}: is(function)`)

      // Custom `api.is` + fallback `|| arg.call` when `api.is` rejects functions
      v.api.is = (x) => Boolean(x && x.$customSignal)
      is(v.is({ $customSignal: true }), true, `${v.name}: is(custom signal) === true`)
      is(v.is(plainFn), true, `${v.name}: is(function) still true via || arg.call`)
      is(v.is({ $customSignal: false }), false, `${v.name}: is(non-matching object) === false`)
    }
    resetAllApis()
  })

  // =========================================================================
  // 4. `sub()` falsy, primitive, and plain non-observable target edge cases
  // =========================================================================
  t('sub(): falsy targets, truthy primitives, Symbols, and plain objects safely no-op', () => {
    resetAllApis()

    for (const v of variants) {
      let called = false
      const spy = () => { called = true }

      // Falsy targets short-circuit and return the falsy target itself
      is(v.sub(undefined, spy), undefined, `${v.name}: sub(undefined)`)
      is(v.sub(null, spy), null, `${v.name}: sub(null)`)
      is(v.sub(false, spy), false, `${v.name}: sub(false)`)
      is(v.sub(0, spy), 0, `${v.name}: sub(0)`)
      is(v.sub(-0, spy), -0, `${v.name}: sub(-0)`)
      is(v.sub(NaN, spy), NaN, `${v.name}: sub(NaN)`)
      is(v.sub('', spy), '', `${v.name}: sub('')`)
      is(v.sub(0n, spy), 0n, `${v.name}: sub(0n)`)

      // Truthy primitives, registered/local Symbols, and plain non-observable objects
      // safely return falsy (`false` or `undefined`) without throwing or invoking callbacks
      for (const nonObs of [
        42,
        'non-empty',
        true,
        1n,
        Symbol('local-sym'),
        Symbol.for('global-sym'),
        {},
        Object.create(null),
        [1, 2, 3],
        new Map(),
        new Set(),
      ]) {
        const ret = v.sub(nonObs, spy, spy, spy)
        is(Boolean(ret), false, `${v.name}: sub(non-observable) returns falsy without throwing`)
      }

      is(called, false, `${v.name}: next/error/cleanup never called on non-observable targets`)
    }
  })

  // =========================================================================
  // 5. Observable, `Symbol.observable`, and teardown deduplication (`src`)
  // =========================================================================
  t('Observable: Symbol.observable, teardown variants, unwrapping, errors, complete+off & double-off dedup', async () => {
    resetAllApis()
    is(typeof Symbol.observable, 'symbol', 'Symbol.observable is defined as a symbol')

    // 5a. Pure [Symbol.observable] wrapper that calls complete():
    //     subsequent off() runs subscription teardown WITHOUT double-calling cleanup!
    {
      const events = []
      const interopObs = {
        [Symbol.observable]() {
          return {
            subscribe(next, error, complete) {
              next(1)
              next(() => 2) // unwrapped via get(v)!
              next(0)       // falsy value preserved
              next(false)   // falsy value preserved
              next('')      // falsy value preserved
              next(null)    // null preserved
              complete()
              return () => events.push('fn-teardown')
            }
          }
        }
      }
      const off = sub(
        interopObs,
        (v) => events.push(['next', v]),
        (e) => events.push(['err', e]),
        () => events.push('cleanup')
      )
      is(events, [
        ['next', 1],
        ['next', 2],
        ['next', 0],
        ['next', false],
        ['next', ''],
        ['next', null],
        'cleanup',
      ], 'Symbol.observable unwraps functions, preserves falsy values, and runs complete once')

      off()
      is(
        events,
        [
          ['next', 1],
          ['next', 2],
          ['next', 0],
          ['next', false],
          ['next', ''],
          ['next', null],
          'cleanup',
          'fn-teardown',
        ],
        'off() after complete() runs fn-teardown without duplicate cleanup()'
      )
    }

    // 5b. Uncompleted observable: manual off() runs teardown + cleanup once and returns cleanup result
    {
      const events = []
      const liveObs = {
        subscribe(next) {
          next('a')
          return () => events.push('teardown')
        }
      }
      const off = sub(liveObs, (v) => events.push(v), null, () => (events.push('clean'), 'clean-ret'))
      const ret = off()
      is(ret, 'clean-ret', 'off() returns cleanup return value when not yet completed')
      is(events, ['a', 'teardown', 'clean'], 'off() invokes teardown and cleanup once')
      // Calling off() a second time is an idempotent no-op
      is(off(), 0, 'second manual off() is a no-op')
      is(events, ['a', 'teardown', 'clean'], 'second manual off() does not re-run teardown or cleanup')
    }

    // 5c. [Symbol.observable]() returning null/undefined falls back to target.subscribe
    {
      const events = []
      const fallbackObs = {
        [Symbol.observable]: () => null,
        subscribe(next) {
          next('from-target-subscribe')
          return {
            tag: 'sub-obj',
            unsubscribe() {
              events.push(`unsub:${this.tag}`)
            }
          }
        }
      }
      const off = sub(fallbackObs, (v) => events.push(v))
      is(events, ['from-target-subscribe'], 'falls back to target.subscribe when [Symbol.observable]() is null')
      is(off(), undefined, 'off() without cleanup returns undefined')
      is(events, ['from-target-subscribe', 'unsub:sub-obj'], 'unsubscribe() called with subscription as `this`')
    }

    // 5d. subscribe() returning truthy object WITHOUT .unsubscribe (e.g. `{}`)
    {
      const events = []
      const bareSubObs = {
        subscribe(next) {
          next('ok')
          return {} // truthy, neither callable nor has .unsubscribe
        }
      }
      const off = sub(bareSubObs, (v) => events.push(v), null, () => events.push('clean'))
      is(events, ['ok'])
      off()
      is(events, ['ok', 'clean'], 'truthy object without .unsubscribe safely runs cleanup')
    }

    // 5e. Observable error callback forwarding
    {
      const events = []
      const errObs = {
        subscribe(_next, error) {
          error(new Error('obs-fail'))
          return () => events.push('teardown')
        }
      }
      const off = sub(errObs, (v) => events.push(v), (e) => events.push(e.message), () => events.push('clean'))
      is(events, ['obs-fail'], 'observable error forwarded without running cleanup')
      off()
      is(events, ['obs-fail', 'teardown', 'clean'])
    }

    // 5f. subscribe() returning undefined does NOT fall through into asyncIterator
    {
      const events = []
      const voidSubObs = {
        subscribe(next) {
          next('from-void-subscribe')
          return undefined
        },
        async *[Symbol.asyncIterator]() {
          yield 'must-not-run'
        }
      }
      const off = sub(voidSubObs, (v) => events.push(v), (e) => events.push(e), () => events.push('done'))
      await tick(4)
      is(events, ['from-void-subscribe'], 'void subscribe does not fall through to asyncIterator')
      off()
      is(events, ['from-void-subscribe', 'done'], 'off() on void subscribe still invokes cleanup once')
    }

    // 5g. Manual unsubscribe prevents duplicate teardown when target is later GC'd
    {
      const events = []
      ;(() => {
        const obs = {
          subscribe() {
            events.push('sub')
            return () => events.push('teardown')
          }
        }
        const off = sub(obs, () => {}, null, () => events.push('clean'))
        off()
      })()
      is(events, ['sub', 'teardown', 'clean'])
      await gc()
      is(events, ['sub', 'teardown', 'clean'], 'FinalizationRegistry does not re-run teardown after manual off()')
    }

    // 5h. Malformed [Symbol.observable] returning object without .subscribe falls through safely
    {
      const errs = []
      const malformed = { [Symbol.observable]: () => ({}) }
      sub(malformed, () => {}, (e) => errs.push(e instanceof TypeError))
      await tick(3)
      is(errs, [true], 'malformed [Symbol.observable]() without .subscribe reports TypeError via error cb')
    }
  })

  // =========================================================================
  // 6. `observ` / `observable` (`target.set && target.call?.(stop, emit)`)
  // =========================================================================
  t('observ-* pattern: manual off, unwrapping, null next, GC cleanup, .set fallthrough, and lite/tiny diff', async () => {
    resetAllApis()
    const { default: Observ } = await import('observ')
    const { default: Observable } = await import('observable')

    // Manual unsubscribe + function unwrapping + null next safety on `observ`
    {
      const arr = []
      const v = Observ(10)
      const off = sub(v, (x) => arr.push(x))
      sub(v, null) // null `next` must not throw when v.set() fires
      v.set(20)
      v.set(() => 25)
      off()
      v.set(30)
      is(arr, [20, 25], 'observ unwraps functions, tolerates null next, and respects off()')
    }
    {
      const arr = []
      const v = Observable(10)
      const off = sub(v, (x) => arr.push(x))
      v(20)
      v.set(25)
      off()
      v(30)
      is(arr, [10, 20, 25], 'observable emits initial value, v(x), v.set(x), and respects off()')
    }

    // GC cleanup on custom observ-like source
    {
      const events = []
      ;(() => {
        const fn = (listener) => {
          events.push(['listen', typeof listener])
          return () => events.push('observ-gc-unsub')
        }
        fn.set = () => {}
        sub(fn, () => {})
      })()
      is(events, [['listen', 'function']])
      await gc()
      is(events, [['listen', 'function'], 'observ-gc-unsub'], 'GC runs observ unsubscriber')
    }

    // Non-callable object with `.set` property safely falls through to `.then` or custom `api.is`
    {
      const arr = []
      const setWithPromise = {
        set: () => {},
        then(ok) {
          ok(777)
          return Promise.resolve()
        }
      }
      sub(setWithPromise, (x) => arr.push(x), null, () => arr.push('done'))
      is(arr, [777, 'done'], 'non-callable object with .set falls through to .then')

      api.is = (x) => Boolean(x && x.__sigWithSet)
      api.get = (x) => x.val
      const sigArr = []
      sub({ __sigWithSet: true, set() {}, val: 88 }, (x) => sigArr.push(x), null, () => {})
      is(sigArr, [88], 'custom non-callable signal with .set falls through target.call?.() to api.effect')
      resetAllApis()
    }

    // Callable with `.set` returning undefined falls through to `api.effect`
    {
      const arr = []
      const voidObserv = (arg) => (arg === undefined ? 'read-val' : undefined)
      voidObserv.set = () => {}
      sub(voidObserv, (x) => arr.push(x), null, () => arr.push('clean'))
      is(arr, ['read-val'], 'callable .set returning undefined falls through to api.effect')
    }

    // In lite and tiny, observ/observable falls into callable/effect branch (reads initial value once)
    {
      const liteArr = []
      const tinyArr = []
      const v1 = Observ(5)
      const v2 = Observ(6)
      liteSub(v1, (x) => liteArr.push(x), null, () => {})
      tinySub(v2, (x) => tinyArr.push(x), null, () => {})
      v1.set(50)
      v2.set(60)
      is(liteArr, [5], 'lite treats observ as plain getter function (no .set subscription)')
      is(tinyArr, [6], 'tiny treats observ as plain getter function (no .set subscription)')
    }
  })

  // =========================================================================
  // 7. `api.any`, `api.effect`, `api.cleanup`, and `|| target.call` across ALL 3
  // =========================================================================
  t('api customization: default effect, no-cleanup fn, api.cleanup, || target.call, api.any fallbacks & GC', async () => {
    resetAllApis()

    // 7a. Untouched default `api` with plain & nested functions + `api.cleanup`
    for (const v of variants) {
      const events = []
      const cleanFn = () => events.push('clean-fn')
      v.api.cleanup = (c) => events.push(['api.cleanup', c === cleanFn])

      const ret = v.sub(() => () => 'val', (x) => events.push(['next', x]), null, cleanFn)
      is(ret, cleanFn, `${v.name}: default api.effect returns cleanup fn as unsub`)
      is(events, [['next', 'val'], ['api.cleanup', true]], `${v.name}: default effect + api.cleanup invoked`)
      v.api.cleanup = undefined

      // Plain function WITHOUT cleanup must NOT fall through to `for await` or invoke `error`!
      const noCleanEvents = []
      ;(() => {
        const fn = () => 'once'
        const off = v.sub(fn, (x) => noCleanEvents.push(['next', x]), (e) => noCleanEvents.push(['err', e]))
        is(off, undefined, `${v.name}: plain fn without cleanup returns undefined`)
      })()
      is(noCleanEvents, [['next', 'once']], `${v.name}: plain fn without cleanup never triggers error`)
    }

    // 7b. `|| target.call` branch when `api.is` returns false for plain functions
    for (const v of variants) {
      v.api.is = (x) => Boolean(x && x.__onlyCustom)
      v.api.get = (x) => x.val
      const out = []
      const cleanup = () => 'c'
      const off = v.sub(() => 'via-target-call', (x) => out.push(x), null, cleanup)
      is(out, ['via-target-call'], `${v.name}: || target.call handles plain fn when api.is is false`)
      is(off, cleanup, `${v.name}: returns cleanup`)
    }
    resetAllApis()

    // 7b-solid. Void-disposer effect (like bare Solid.js `createEffect`) neither falls through nor loses `target` across reactive updates
    for (const v of variants) {
      let rerun
      let cleanPending
      v.api.effect = (fn) => { rerun = () => { cleanPending?.(); cleanPending = undefined; fn() }; rerun() }
      v.api.cleanup = (c) => { cleanPending = c }
      let val = 10
      const solidSig = () => val
      solidSig.then = () => { throw new Error('must not fall through to .then') }
      solidSig[Symbol.asyncIterator] = () => { throw new Error('must not fall through to asyncIterator') }
      const log = []
      const ret = v.sub(solidSig, (x) => log.push(x), null, () => log.push('clean'))
      is(ret, undefined, `${v.name}: void-disposer effect returns undefined without falling through`)
      val = 20
      rerun()
      val = 30
      rerun()
      is(log, [10, 'clean', 20, 'clean', 30], `${v.name}: void-disposer effect keeps tracking target across updates`)
    }
    resetAllApis()

    // 7c. `api.any` selective fallback:
    //   - `api.any(target)` returning undefined falls back to `api.effect`
    //   - `api.any(target)(next, error, cleanup)` returning undefined falls back to `api.effect`
    //   - `api.effect = undefined` safely evaluates `api.effect?.(...)` to undefined without falling into async-iter
    for (const v of variants) {
      const log = []
      v.api.is = (x) => Boolean(x && x.kind)
      v.api.get = (x) => x.val
      v.api.effect = (f) => (f(), () => log.push('effect-dispose'))
      v.api.any = (target) => {
        if (target.kind === 'decline-outer') return undefined
        if (target.kind === 'decline-inner') return () => undefined
        return (next, error, cleanup) => {
          next(`any:${target.val}`)
          error?.('any-err')
          cleanup?.()
          return () => log.push(`any-off:${target.val}`)
        }
      }

      const off1 = v.sub({ kind: 'decline-outer', val: 1 }, (x) => log.push(x))
      const off2 = v.sub({ kind: 'decline-inner', val: 2 }, (x) => log.push(x))
      const off3 = v.sub(
        { kind: 'handled', val: 3 },
        (x) => log.push(x),
        (e) => log.push(e),
        () => log.push('any-clean')
      )

      is(log, [1, 2, 'any:3', 'any-err', 'any-clean'], `${v.name}: api.any selective handling & fallbacks`)
      off1()
      off2()
      off3()
      is(
        log.slice(-3),
        ['effect-dispose', 'effect-dispose', 'any-off:3'],
        `${v.name}: disposers match chosen path`
      )

      // Both api.any and api.effect set to undefined -> returns undefined cleanly in all 3 tiers
      v.api.any = undefined
      v.api.effect = undefined
      const errs = []
      const offNone = v.sub({ kind: 'no-handler', val: 4 }, () => {}, (e) => errs.push(e))
      is(offNone, undefined, `${v.name}: returns undefined when both any & effect are undefined`)
      is(errs, [], `${v.name}: no spurious fallthrough error when both any & effect are undefined`)
    }
    resetAllApis()

    // 7d. FinalizationRegistry GC cleanup on `api.any` across ALL 3 (`src`, `lite`, `tiny`)
    {
      const gcEvents = []
      for (const v of variants) {
        v.api.is = (x) => Boolean(x && x.__anyGc)
        v.api.any = (target) => {
          const id = target.id
          return () => () => gcEvents.push(`${v.name}:${id}`)
        }
      }
      ;(() => {
        for (const v of variants) {
          v.sub({ __anyGc: true, id: 'dropped' }, () => {})
        }
      })()
      resetAllApis()

      await gc()
      is(
        gcEvents.sort(),
        ['lite:dropped', 'src:dropped', 'tiny:dropped'],
        'FinalizationRegistry invokes api.any unsubscribers in src, lite, and tiny'
      )
    }

    // 7e. @preact/signals-core via `api` in `lite` and `tiny` (where `.subscribe` is absent)
    {
      const { effect, signal, Signal } = await import('@preact/signals-core')
      for (const v of [variants[1], variants[2]]) {
        v.api.effect = effect
        v.api.is = (x) => x instanceof Signal
        v.api.get = (x) => x.value

        const seen = []
        const sig = signal(1)
        const off = v.sub(sig, (x) => seen.push(x), null, () => seen.push('clean'))
        sig.value = 2
        off()
        sig.value = 3
        is(seen, [1, 'clean', 2, 'clean'], `${v.name}: Preact Signal reactive updates & per-effect cleanup via api.effect`)
      }
      resetAllApis()
    }
  })

  // =========================================================================
  // 8. Promise & Thenable edge cases across `src`, `lite`, and `tiny`
  // =========================================================================
  t('Promise & Thenables: resolve, reject, falsy/unwrapped values, stop cancellation, sync thenable across src/lite/tiny', async () => {
    resetAllApis()

    for (const v of variants) {
      // 8a. Resolved Promise with nested function unwrapping + cleanup
      {
        const log = []
        const p = Promise.resolve(() => () => 42)
        const off = v.sub(p, (x) => log.push(x), (e) => log.push(e), () => log.push('done'))
        is(typeof off, 'function', `${v.name}: sub(Promise) returns stop fn`)
        await tick(3)
        is(log, [42, 'done'], `${v.name}: Promise unwraps nested function & calls cleanup`)
      }

      // 8b. Resolved Promise with falsy values & omitted cleanup
      {
        const log = []
        for (const val of [0, false, '', null, undefined]) {
          v.sub(Promise.resolve(val), (x) => log.push(x))
        }
        await tick(3)
        is(log, [0, false, '', null, undefined], `${v.name}: Promise delivers all falsy values without cleanup`)
      }

      // 8c. Rejected Promise invokes error and skips next + cleanup
      {
        const log = []
        const p = Promise.reject(new Error(`fail-${v.name}`))
        v.sub(p, (x) => log.push(['next', x]), (e) => log.push(['err', e.message]), () => log.push('done'))
        await tick(3)
        is(log, [['err', `fail-${v.name}`]], `${v.name}: rejected Promise calls error only`)
      }

      // 8d. Unsubscribing (`off()`) BEFORE Promise resolves suppresses BOTH `next` AND `cleanup`!
      {
        const log = []
        let resolveP
        const p = new Promise((r) => { resolveP = r })
        const off = v.sub(p, (x) => log.push(['next', x]), (e) => log.push(['err', e]), () => log.push('cleanup'))
        off() // sets stop = 1 before resolution!
        resolveP('late-value')
        await tick(3)
        is(log, [], `${v.name}: off() before resolve prevents both next(v) and cleanup()`)
      }

      // 8e. Synchronous custom thenable returning truthy
      {
        const log = []
        const syncThenable = {
          then(ok) {
            ok('sync-ok')
            return this
          }
        }
        const off = v.sub(syncThenable, (x) => log.push(x), null, () => log.push('sync-done'))
        is(log, ['sync-ok', 'sync-done'], `${v.name}: sync thenable fires synchronously`)
        is(typeof off, 'function', `${v.name}: sync thenable returns stop fn`)
      }
    }

    // 8f. Custom thenable in `tiny` whose `.then()` returns `undefined`
    {
      const tinyLog = []
      const voidThenable = { then(ok) { ok('tiny-sync') } }
      const ret = tinySub(voidThenable, (x) => tinyLog.push(x), null, () => tinyLog.push('done'))
      is(tinyLog, ['tiny-sync', 'done'], 'tiny handles void-returning thenable')
      is(ret, undefined, 'tiny returns undefined when then() returns undefined')
    }
  })

  // =========================================================================
  // 9. AsyncIterable edge cases across `src`, `lite`, `tiny`
  // =========================================================================
  t('AsyncIterable: values, empty stream, mid-stream stop, immediate stop, errors, and absence in tiny', async () => {
    resetAllApis()

    for (const v of [variants[0], variants[1]]) {
      // 9a. Async generator yielding falsy values & functions, without cleanup
      {
        const log = []
        async function* gen() {
          yield 0
          yield ''
          yield false
          yield () => 'unwrapped'
        }
        const off = v.sub(gen(), (x) => log.push(x))
        is(typeof off, 'function', `${v.name}: sub(asyncGen) returns stop fn`)
        await tick(10)
        is(log, [0, '', false, 'unwrapped'], `${v.name}: async generator emits falsy & unwrapped values`)
      }

      // 9b. Empty async generator invokes cleanup immediately without calling next
      {
        const log = []
        async function* empty() {}
        v.sub(empty(), (x) => log.push(['next', x]), (e) => log.push(['err', e]), () => log.push('empty-done'))
        await tick(5)
        is(log, ['empty-done'], `${v.name}: empty async generator runs cleanup only`)
      }

      // 9c. Mid-stream unsubscribe (`if (stop) return;`) stops emissions, skips cleanup, and closes generator (`finally`)
      {
        const log = []
        let stepResolve
        async function* controlled() {
          try {
            yield 1
            yield await new Promise((r) => { stepResolve = r })
            yield 3
          } finally {
            log.push('generator-finally')
          }
        }
        const off = v.sub(
          controlled(),
          (x) => log.push(['next', x]),
          (e) => log.push(['err', e]),
          () => log.push('cleanup')
        )
        await tick(4)
        is(log, [['next', 1]], `${v.name}: received first item before stop`)

        off() // sets stop = 1 while awaiting 2nd yield
        stepResolve(2)
        await tick(6)
        is(
          log,
          [['next', 1], 'generator-finally'],
          `${v.name}: mid-stream off() exits loop via return, runs generator finally, skips item 2 & cleanup`
        )
      }

      // 9d. Immediate unsubscribe before first item resolves emits nothing
      {
        const log = []
        let firstResolve
        async function* delayed() {
          yield await new Promise((r) => { firstResolve = r })
        }
        const off = v.sub(delayed(), (x) => log.push(x), null, () => log.push('cleanup'))
        off()
        firstResolve('never-seen')
        await tick(6)
        is(log, [], `${v.name}: immediate off() emits nothing and skips cleanup`)
      }

      // 9e. Async generator throwing error WITH error callback -> calls error(err), skips cleanup
      {
        const log = []
        async function* failing() {
          yield 'before-err'
          throw new Error(`iter-boom-${v.name}`)
        }
        v.sub(
          failing(),
          (x) => log.push(['next', x]),
          (e) => log.push(['err', e.message]),
          () => log.push('cleanup')
        )
        await tick(6)
        is(
          log,
          [['next', 'before-err'], ['err', `iter-boom-${v.name}`]],
          `${v.name}: async iterable error caught and forwarded to error callback`
        )
      }

      // 9f. Async generator throwing error WITHOUT error callback -> swallowed safely (`error || is`)
      {
        const log = []
        async function* failingNoHandler() {
          yield 'ok'
          throw new Error('swallowed')
        }
        v.sub(failingNoHandler(), (x) => log.push(x))
        await tick(6)
        is(log, ['ok'], `${v.name}: async iterable error without error handler does not reject unhandled`)
      }
    }

    // 9g. `tiny` ignores AsyncIterable completely
    {
      const log = []
      async function* gen() { yield 1 }
      const g = gen()
      is(tinyIs(g), false, 'tiny: is(asyncGen) is false')
      is(tinySub(g, (x) => log.push(x)), undefined, 'tiny: sub(asyncGen) returns undefined')
      await tick(4)
      is(log, [], 'tiny: does not iterate asyncGen')
    }
  })

  // =========================================================================
  // 10. Multi-protocol precedence order when target implements several APIs
  // =========================================================================
  t('Protocol precedence order: [Symbol.observable] > .subscribe > .set+call > api.any > api.effect > .then > asyncIterator', async () => {
    resetAllApis()

    // 10a. [Symbol.observable] beats .subscribe on `src`
    {
      const log = []
      const dual = {
        [Symbol.observable]: () => ({
          subscribe(next) { next('sym-observable'); return () => {} }
        }),
        subscribe(next) { next('dot-subscribe'); return () => {} }
      }
      sub(dual, (x) => log.push(x))
      is(log, ['sym-observable'], '[Symbol.observable] takes precedence over .subscribe')
    }

    // 10b. .subscribe beats .set + callable (`observ`) on `src`
    {
      const log = []
      const fn = () => { log.push('called-observ'); return () => {} }
      fn.set = () => {}
      fn.subscribe = (next) => { next('dot-subscribe'); return () => {} }
      sub(fn, (x) => log.push(x))
      is(log, ['dot-subscribe'], '.subscribe takes precedence over .set + callable')
    }

    // 10c. .set + callable beats `api.any` / `api.effect` on `src`, whereas `api.any` wins on `lite` & `tiny`
    {
      for (const v of variants) {
        v.api.any = () => (next) => { next('from-any'); return () => {} }
        const log = []
        const fn = (cb) => { cb('from-observ'); return () => {} }
        fn.set = () => {}
        v.sub(fn, (x) => log.push(x))
        is(
          log,
          [v.hasObserv ? 'from-observ' : 'from-any'],
          `${v.name}: ${v.hasObserv ? '.set+call beats api.any' : 'api.any handles observ fn'}`
        )
      }
      resetAllApis()
    }

    // 10d. `api.is` / `target.call` beats `.then` (callable thenable) across all 3
    {
      for (const v of variants) {
        const log = []
        const callableThenable = Object.assign(() => 'from-call', {
          then(ok) { ok('from-then'); return Promise.resolve() }
        })
        v.sub(callableThenable, (x) => log.push(x), null, () => {})
        await tick(3)
        is(log, ['from-call'], `${v.name}: callable takes precedence over .then`)
      }
    }

    // 10e. `.then` beats `[Symbol.asyncIterator]` across `src` and `lite`
    {
      for (const v of [variants[0], variants[1]]) {
        const log = []
        const thenableAsyncIter = {
          then(ok) { ok('from-then'); return Promise.resolve() },
          async *[Symbol.asyncIterator]() { yield 'from-async-iter' }
        }
        v.sub(thenableAsyncIter, (x) => log.push(x), null, () => log.push('done'))
        await tick(4)
        is(log, ['from-then', 'done'], `${v.name}: .then takes precedence over [Symbol.asyncIterator]`)
      }
    }
  })

  // =========================================================================
  // 11. Built bundles (`es`, `cjs`, `umd`, `iife`) & package exports
  // =========================================================================
  t('Build outputs: ESM, native CJS require(), UMD (CJS/AMD/Global), and IIFE (.min.js) for root, lite, and tiny', async () => {
    if (!fs.existsSync(path.join(rootDir, 'dist/index.es.js'))) {
      const { rollup } = await import('rollup')
      const { default: configs } = await import('../rollup.config.js')
      for (const cfg of configs) {
        const bundle = await rollup(cfg)
        for (const out of cfg.output) await bundle.write(out)
        await bundle.close()
      }
    }

    const req = createRequire(import.meta.url)
    const targets = [
      { label: 'root', dir: 'dist', pkgSubpath: 'usub', hasSub: true, hasAsync: true },
      { label: 'lite', dir: 'lite/dist', pkgSubpath: 'usub/lite', hasSub: false, hasAsync: true },
      { label: 'tiny', dir: 'tiny/dist', pkgSubpath: 'usub/tiny', hasSub: false, hasAsync: false },
    ]

    const prevSymObs = Symbol.observable

    for (const item of targets) {
      const base = path.join(rootDir, item.dir)

      // 11a. ESM bundle & package self-reference import
      const esMod = await import(path.join(base, 'index.es.js'))
      const pkgMod = await import(item.pkgSubpath)
      is(esMod, pkgMod, `${item.label}: ESM package export resolves to index.es.js`)
      is(typeof esMod.sub, 'function', `${item.label} es: exports sub`)
      is(typeof esMod.is, 'function', `${item.label} es: exports is`)
      is(typeof esMod.get, 'function', `${item.label} es: exports get`)
      is(typeof esMod.api, 'object', `${item.label} es: exports api`)
      is(esMod.is({ subscribe() {} }), item.hasSub, `${item.label} es: subscribe support matches tier`)
      is(esMod.is({ async *[Symbol.asyncIterator]() {} }), item.hasAsync, `${item.label} es: asyncIter support matches tier`)

      // 11b. Native Node.js CommonJS `require()` on package subpath AND `.cjs` file!
      const cjsPkg = req(item.pkgSubpath)
      const cjsFile = req(path.join(base, 'index.cjs'))
      is(cjsPkg, cjsFile, `${item.label} cjs: require('${item.pkgSubpath}') resolves to index.cjs`)
      is(cjsPkg.get(() => 123), 123, `${item.label} cjs: get(() => 123) === 123`)
      is(cjsPkg.is(Promise.resolve()), true, `${item.label} cjs: is(Promise) === true`)
      const cjsVals = []
      cjsPkg.sub(Promise.resolve('cjs-ok'), (x) => cjsVals.push(x), null, () => cjsVals.push('end'))
      await tick(3)
      is(cjsVals, ['cjs-ok', 'end'], `${item.label} cjs: sub(Promise) works via require()`)

      // 11c. IIFE minified bundle (`index.min.js`) in browser-like global context
      const minCode = fs.readFileSync(path.join(base, 'index.min.js'), 'utf8')
      const iifeCtx = vm.createContext({ FinalizationRegistry, Symbol, Promise })
      vm.runInContext(minCode, iifeCtx)
      is(typeof iifeCtx.usub.sub, 'function', `${item.label} min.js: attaches global usub`)
      const iifeVals = []
      iifeCtx.usub.sub(Promise.resolve('iife-ok'), (x) => iifeVals.push(x), null, () => iifeVals.push('end'))
      await tick(3)
      is(iifeVals, ['iife-ok', 'end'], `${item.label} min.js: Promise subscription works`)

      // 11d. UMD bundle (`index.umd.js`) across CommonJS, AMD, and Browser Global environments
      const umdCode = fs.readFileSync(path.join(base, 'index.umd.js'), 'utf8')

      // UMD -> CommonJS branch
      const umdCjsExports = {}
      vm.runInNewContext(umdCode, {
        exports: umdCjsExports,
        module: { exports: umdCjsExports },
        FinalizationRegistry,
        Symbol,
        Promise,
      })
      is(umdCjsExports.get(() => 'umd-cjs'), 'umd-cjs', `${item.label} umd (CJS): works`)

      // UMD -> AMD branch
      let amdExports
      const define = (deps, factory) => {
        is(deps, ['exports'], `${item.label} umd (AMD): requests ['exports']`)
        amdExports = {}
        factory(amdExports)
      }
      define.amd = true
      vm.runInNewContext(umdCode, { define, FinalizationRegistry, Symbol, Promise })
      is(amdExports.get(() => 'umd-amd'), 'umd-amd', `${item.label} umd (AMD): works`)

      // UMD -> Browser globalThis branch
      const umdGlobalCtx = vm.createContext({ FinalizationRegistry, Symbol, Promise })
      umdGlobalCtx.globalThis = umdGlobalCtx
      vm.runInContext(umdCode, umdGlobalCtx)
      is(umdGlobalCtx.usub.get(() => 'umd-global'), 'umd-global', `${item.label} umd (global): works`)
    }

    // Re-evaluating Symbol.observable ||= Symbol('observable') preserved existing Symbol.observable
    is(Symbol.observable, prevSymObs, 'Symbol.observable preserved across subsequent bundle evaluations')
  })

  // =========================================================================
  // 12. Advanced edge cases: RxJS BehaviorSubject/ReplaySubject, multi-subscriber
  //     isolation, null/missing callbacks, trailing parameter slots, and GC retention
  // =========================================================================
  t('Advanced edge cases: BehaviorSubject/ReplaySubject, multi-sub isolation, null next safety, and GC retention', async () => {
    resetAllApis()
    const { BehaviorSubject, ReplaySubject, Subject } = await import('rxjs')

    // 12a. RxJS BehaviorSubject emits current value synchronously upon sub()
    {
      const bs = new BehaviorSubject('init')
      const seen = []
      const off = sub(bs, (x) => seen.push(x), null, () => seen.push('clean'))
      is(seen, ['init'], 'BehaviorSubject emits initial value synchronously on sub()')
      bs.next('second')
      off()
      bs.next('ignored')
      is(seen, ['init', 'second', 'clean'], 'BehaviorSubject updates and unsubscribes cleanly')
    }

    // 12b. RxJS ReplaySubject replays buffered values synchronously and unwraps functions
    {
      const rs = new ReplaySubject(2)
      rs.next('r1')
      rs.next(() => 'r2')
      rs.next('r3')
      const seen = []
      const off = sub(rs, (x) => seen.push(x))
      is(seen, ['r2', 'r3'], 'ReplaySubject(2) replays last 2 buffered items and unwraps fn')
      off()
    }

    // 12c. Multiple independent subscribers on the same source (Observable, Promise, AsyncIterable)
    {
      const subj = new Subject()
      const a = [], b = [], c = []
      const offA = sub(subj, (x) => a.push(x))
      const offB = sub(subj, (x) => b.push(x))
      const offC = sub(subj, (x) => c.push(x))
      subj.next(1)
      offB() // only B unsubscribes
      subj.next(2)
      offA()
      subj.next(3)
      offC()
      is(a, [1, 2], 'subscriber A isolated')
      is(b, [1], 'subscriber B isolated after offB()')
      is(c, [1, 2, 3], 'subscriber C continues unaffected')

      // Shared Promise across src and lite where one subscriber cancels
      let resolveShared
      const sharedP = new Promise((r) => { resolveShared = r })
      const pKept = [], pCancelled = []
      sub(sharedP, (x) => pKept.push(x), null, () => pKept.push('done'))
      const cancelOne = liteSub(sharedP, (x) => pCancelled.push(x), null, () => pCancelled.push('done'))
      cancelOne()
      resolveShared('shared-val')
      await tick(4)
      is(pKept, ['shared-val', 'done'], 'active Promise subscriber receives value and cleanup')
      is(pCancelled, [], 'cancelled Promise subscriber suppresses both value and cleanup independently')

      // Reusable AsyncIterable factory (independent iterators per subscriber)
      const reusableAsync = {
        async *[Symbol.asyncIterator]() {
          yield 'x'
          yield 'y'
        }
      }
      const iter1 = [], iter2 = []
      sub(reusableAsync, (x) => iter1.push(x))
      liteSub(reusableAsync, (x) => iter2.push(x))
      await tick(6)
      is(iter1, ['x', 'y'], 'src subscriber gets full async sequence')
      is(iter2, ['x', 'y'], 'lite subscriber gets independent full async sequence')
    }

    // 12d. Null/omitted `next` callback succeeds cleanly across EVERY protocol!
    {
      // Observable emitting values + completing with null `next`
      const obsLog = []
      const emitObs = { subscribe(n, _e, complete) { n(1); n(2); complete(); return () => {} } }
      sub(emitObs, null, null, () => obsLog.push('obs-complete'))
      is(obsLog, ['obs-complete'], 'observable emitting with null next completes without throwing')

      // Function / Signal effect with null `next` across all 3 tiers
      for (const v of variants) {
        const cleanLog = []
        const off = v.sub(() => 123, null, null, () => cleanLog.push('fn-clean'))
        off()
        is(cleanLog, ['fn-clean'], `${v.name}: function effect with null next succeeds`)

        // Resolved Promise with null `next` across all 3 tiers
        const pLog = []
        v.sub(Promise.resolve(456), null, null, () => pLog.push('prom-clean'))
        await tick(3)
        is(pLog, ['prom-clean'], `${v.name}: resolved Promise with null next runs cleanup cleanly`)
      }

      // AsyncIterable yielding values with null `next` across src & lite
      for (const v of [variants[0], variants[1]]) {
        const aiLog = []
        async function* items() { yield 1; yield 2 }
        v.sub(items(), null, (e) => aiLog.push(['err', e]), () => aiLog.push('ai-clean'))
        await tick(6)
        is(aiLog, ['ai-clean'], `${v.name}: AsyncIterable with null next completes cleanly`)
      }
    }

    // 12e. White-box parameter-slot edge cases: `sub(target, next, error, cleanup, stop, unsub, fx)`
    {
      for (const v of variants) {
        const log = []
        v.sub(Promise.resolve('skipped'), (x) => log.push(x), null, () => log.push('clean'), 1)
        await tick(3)
        is(log, [], `${v.name}: truthy 5th arg (stop=1) suppresses Promise next and cleanup`)
      }

      const mockLog = []
      ;(() => {
        const mock = { subscribe() { mockLog.push('sub'); return () => mockLog.push('gc-unsub') } }
        sub(mock, () => {}, null, null, undefined, undefined, 1)
      })()
      await gc()
      is(mockLog, ['sub'], 'truthy 7th arg (fx=1) skips FinalizationRegistry registration')
    }

    // 12f. FinalizationRegistry retention hazard demonstration on `api.any`
    {
      let retainedRef, collectedRef
      const makeRetaining = (tObj) => () => tObj
      const makeNonRetaining = () => () => {}
      api.is = (x) => Boolean(x && x.__retTest)
      api.any = (target) => () => (target.retainSelf ? makeRetaining(target) : makeNonRetaining())

      ;(() => {
        const leaked = { __retTest: true, retainSelf: true }
        const freed = { __retTest: true, retainSelf: false }
        retainedRef = new WeakRef(leaked)
        collectedRef = new WeakRef(freed)
        sub(leaked, () => {})
        sub(freed, () => {})
      })()
      resetAllApis()

      await gc()
      is(collectedRef.deref(), undefined, 'target without self-reference in unsub is GC collected')
      ok(retainedRef.deref() !== undefined, 'target referenced by non-effect unsub is retained by FinalizationRegistry')
    }
  })

  // =========================================================================
  // 13. `test/https-loader.js` resolve & load hook branches
  // =========================================================================
  t('https-loader: resolve and load hook branches', async () => {
    is(
      httpsResolve('https://cdn.example.com/pkg.js', {}, () => { throw new Error('unexpected') }),
      { shortCircuit: true, url: 'https://cdn.example.com/pkg.js' },
      'resolve short-circuits https:// specifier'
    )

    is(
      httpsResolve('./sub/mod.js', { parentURL: 'https://cdn.example.com/dir/index.js' }, () => { throw new Error('unexpected') }),
      { shortCircuit: true, url: 'https://cdn.example.com/dir/sub/mod.js' },
      'resolve joins relative specifier with https:// parentURL'
    )

    const delegated = httpsResolve('rxjs', { parentURL: 'file:///app/index.js' }, (spec, ctx) => ({
      delegated: spec,
      parent: ctx.parentURL,
    }))
    is(delegated, { delegated: 'rxjs', parent: 'file:///app/index.js' }, 'resolve delegates non-https specifier')

    const delegatedEmptyCtx = httpsResolve('./local.js', {}, (spec) => ({ delegated: spec }))
    is(delegatedEmptyCtx, { delegated: './local.js' }, 'resolve handles empty context (parentURL = null)')

    const loaded = await httpsLoad('file:///app/index.js', { format: 'module' }, async (url, ctx) => ({
      source: `loaded:${url}`,
      format: ctx.format,
    }))
    is(loaded, { source: 'loaded:file:///app/index.js', format: 'module' }, 'load delegates non-https URL')

    let rejected = false
    try {
      await httpsLoad('https://127.0.0.1:1/unreachable.js', {}, async () => {})
    } catch (err) {
      rejected = Boolean(err)
    }
    is(rejected, true, 'load rejects cleanly when https request errors')
  })
}

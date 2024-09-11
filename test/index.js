import t, { is } from 'tst'
import { sub, api, get, is as isObs } from '../src/index.js'

//https://github.com/dy/wait-please/blob/master/index.js
export function time(n) {
  return new Promise(ok => setTimeout(ok, n))
}
//https://github.com/dy/wait-please/blob/master/index.js
function tick(n = 1) {
  return new Promise(ok => {
    let count = 0
    f()
    function f() {
      if (count === n) return ok()
      count++
      Promise.resolve().then(f)
    }
  })
}
t('Promise: next', async () => {
  let arr = []
  let p = new Promise(ok => setTimeout(() => ok(1)))
  sub(p)(v => arr.push(v), e => arr.push(e), () => arr.push('end'))

  is(arr, [])
  await time()
  is(arr, [1, 'end'])

})
t('Promise: error', async () => {
  let arr = []
  let p = new Promise((ok, err) => setTimeout(() => { err(Error('xyz')) }))
  sub(p)(null, err => arr.push(err.message), done => arr.push(done))

  is(arr, [])
  await time()
  is(arr, ['xyz'])
})

t('rxjs', async () => {
  const arr = []
  const { Subject } = await import('https://cdn.skypack.dev/rxjs')
  const subject = new Subject();

  const unsub = sub(subject)(v => arr.push(v), err => arr.push(err), () => arr.push('end'))

  is(arr, [])
  subject.next(1);
  is(arr, [1])
  subject.next(2);
  is(arr, [1, 2])

  subject.complete()
  is(arr, [1, 2, 'end'])

  unsub()
})

t('observ', async () => {
  const arr = []
  const { default: Observable } = await import('https://cdn.skypack.dev/observ')

  var v = Observable(1)
  sub(v)(v => arr.push(v))
  is(arr, [])
  v.set(2)
  is(arr, [2])
})

t('observable', async () => {
  const arr = []
  const { default: Observable } = await import('https://cdn.skypack.dev/observable')

  var v = Observable(1)
  sub(v)(v => arr.push(v))
  is(arr, [1])
  v(2)
  is(arr, [1, 2])
})


t('asyncIterable', async () => {
  const arr = []

  const asyncIterable = {
    [Symbol.asyncIterator]() {
      return {
        i: 0,
        next() {
          if (this.i < 3) return new Promise(ok => ok({ value: this.i++, done: false }));
          return new Promise(ok => ok({ done: true }));
        }
      };
    }
  };

  sub(asyncIterable)(v => arr.push(v), err => err, v => arr.push('end'))
  is(arr, [])
  await tick()
  is(arr, [0, 1])
  await tick()
  is(arr, [0, 1, 2, 'end'])
})

t('does not keep observer refs for mock', async () => {
  let arr = []
  let mock = { subscribe() { arr.push('sub'); return { unsubscribe: () => arr.push('unsub') } } }

  let unsub = sub(mock)(v => arr.push(v))
  is(arr, ['sub'])

  mock = null

  await gc()

  is(arr, ['sub', 'unsub'])
})

t('collecting callback doesnt invoke unsubscribe', async () => {
  let arr = []
  let mock = { subscribe() { arr.push('sub'); return { unsubscribe: () => arr.push('unsub') } } }
  let cb = v => arr.push(v)
  let unsub = sub(mock)(cb)
  is(arr, ['sub'])

  cb = null

  await gc()

  is(arr, ['sub'])
})

t('does not keep observer refs for signal', async () => {

  const { signal } = await import('https://cdn.skypack.dev/@preact/signals-core')

  let arr = []
  let s1 = signal(0)

  const unsub = sub(s1)(v => arr.push(v), null, () => arr.push('end'))

  is(arr, [0])

  await gc()
  is(arr, [0])

  s1.value = 1
  await tick()
  is(arr, [0, 1])

  // NOTE: this is unwanted
  unsub()
  s1 = null
  await gc()

  is(arr, [0, 1, 'end'])
})

t('solid.js', async () => {
  const { createSignal, createEffect, onCleanup, createRoot } = await import('https://cdn.skypack.dev/solid-js');
  let arr = [];

  api.effect = (f) => {
    let d;
    createRoot((dispose) => {
      d = dispose;
      createEffect(f)
    });
    return d
  };
  api.is = (v) => v?.name?.includes("readSignal");
  api.get = (v) => v?.();
  api.cleanup = onCleanup;

  let [val, setVal] = createSignal(0);
  sub(val)((v) => arr.push(v), null, () => arr.push('clean'));
  setVal(10);
  setVal(20);
  setVal = null;
  await gc();
  // setVal(30);
  is(arr, [0, 'clean', 10, 'clean', 20]);


  arr = [];
  let [val1, setVal1] = createSignal(0);
  const off = sub(val1)((v) => arr.push(v), null, () => arr.push('clean'));
  setVal1(10);
  setVal1(20);
  off();
  setVal1(30);
  is(arr, [0, 'clean', 10, 'clean', 20, 'clean']);

  api.cleanup = void 0;
});

t('usignal', async () => {
  const { effect, signal, Signal } = await import('https://cdn.skypack.dev/usignal');
  let arr = [];

  api.effect = effect;
  api.is = (v) => v instanceof Signal;
  api.get = (v) => v?.value;

  let val = signal(0);
  sub(val)((v) => arr.push(v), null, () => arr.push('clean'));
  await tick();
  val.value = 10;
  await tick();
  val.value = 20;
  await tick();
  val = null;
  await gc();
  // val.value = 30;
  is(arr, [0, 'clean', 10, 'clean', 20])

  arr = [];
  let val1 = signal(0);
  let off = sub(val1)((v) => arr.push(v), null, () => arr.push('clean'));
  await tick();
  val1.value = 10;
  await tick();
  val1.value = 20;
  await tick();
  off();
  val1.value = 30;
  is(arr, [0, 'clean', 10, 'clean', 20, 'clean'])
});

t('@webreflection/signal', async () => {
  const { effect, signal, Signal } = await import('https://cdn.skypack.dev/@webreflection/signal');
  let arr = [];

  api.effect = effect;
  api.is = (v) => v instanceof Signal;
  api.get = (v) => v?.value;

  let val = signal(0);

  sub(val)((v) => arr.push(v), null, () => arr.push('clean'));
  val.value = 10;
  val.value = 20;
  val = null;
  await gc();
  // val.value = 30;
  is(arr, [0, 'clean', 10, 'clean', 20])


  arr = [];
  let val1 = signal(0);
  let off = sub(val1)((v) => arr.push(v), null, () => arr.push('clean'));
  val1.value = 10;
  val1.value = 20;
  off();
  val1.value = 30;
  is(arr, [0, 'clean', 10, 'clean', 20, 'clean'])
});

t('ulive', async () => {
  const { effect, signal } = await import('https://cdn.skypack.dev/ulive');
  let arr = [];

  api.effect = effect;
  api.is = (v) => v?.peek;
  api.get = (v) => v?.value;

  let val = signal(0);
  sub(val)((v) => arr.push(v), null, () => arr.push('clean'));
  val.value = 10;
  val.value = 20;
  // off();
  val = null;
  await gc();
  // val.value = 30;
  is(arr, [0, 'clean', 10, 'clean', 20])


  arr = [];
  let val1 = signal(0);
  let off = sub(val1)((v) => arr.push(v), null, () => arr.push('clean'));
  val1.value = 10;
  val1.value = 20;
  off();
  val1.value = 30;
  is(arr, [0, 'clean', 10, 'clean', 20, 'clean'])
});

t('function', async () => {
  const fun = () => "fun";

  api.effect = f => f();
  api.is = v => v?.call;
  api.get = v => v?.call?.();

  let arr = [];
  sub(fun)((v) => arr.push(v));
  is(arr, ['fun'])
});

t('api.any', async () => {

  let v =
    (val, cb = []) =>
      (c) =>
        c === void 0
          ? val
          : c.call
            ? cb.splice.bind(cb, cb.push(c) - 1, 1, 0)
            : ((val = c), cb.map((f) => f && f(val)));

  api.any = (target) => (next, error, cleanup) => (target?.(next));

  let arr = [];
  let val = v(0);
  sub(val)((v) => arr.push(v));
  val(10);
  val(20);
  val = null;
  await gc();
  // val(30);
  is(arr, [10, 20])


  arr = [];
  let val1 = v(0);
  let off = sub(val1)((v) => arr.push(v));
  val1(10);
  val1(20);
  off();
  val1(30);
  is(arr, [10, 20])
});
async function gc() {
  // gc is async somehow
  await time(50)
  global.gc()
  eval("%CollectGarbage('all')");
  await time(50)
}
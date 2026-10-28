const sym = Symbol.observable ||= Symbol('observable');
const registry = new FinalizationRegistry(unsub => unsub());
const off = (s, c) => _ =>
    c ? s && (s.call ? s() : s.unsubscribe?.(), s = 0, c.pop()?.()) : s[0] = 1;
const api = {
    // any: undefined,            // any placeholder
    // cleanup: undefined,        // cleanup placeholder
    is: v => v?.call,             // is placeholder
    get: v => v?.(),              // get placeholder
    effect: f => f(),             // effect placeholder
};
const get = v => api.is(v) ? get(api.get(v)) : v?.call ? get(v()) : v;
const is = arg => arg && !!(
    api.is(arg) ||                   // Custom observable check
    arg.call ||                      // Function (including observ-*)
    arg[sym] ||                      // Observable symbol
    arg.subscribe ||                 // Observable with subscribe method
    arg.then ||                      // Promise
    arg[Symbol.asyncIterator]        // Async iterator
);

const sub = (target, next, error, cleanup, stop, unsub, fx, emit = v => next?.(get(v))) => is(target) && (
    unsub = (unsub = target[sym]?.() || target).subscribe
        ? (cleanup = [cleanup],
            error = unsub.subscribe(emit, error, _ => cleanup.pop()?.()) || 1,
            /*@__NOINLINE__*/ off(error, cleanup))
        : (api.is(target) || target.call)
            ? target.set && target.length && target(emit) || api.any?.(target)?.(next, error, cleanup) || (fx = 1, api.effect?.(_ => (emit(target), api.cleanup?.(cleanup), cleanup)))
            : (stop = [stop],
                target.then
                    ? target.then(v => stop[0] || (emit(v), cleanup?.()), error)
                    : (async v => {
                        for await (v of target) { if (stop[0]) return; emit(v) }
                        cleanup?.()
                    })().then(0, error || is),
                /*@__NOINLINE__*/ off(stop)),
    fx || (registry.register(target, unsub), target = 0), // effect owned: never park in registry; clear target slot so non-effect closures never retain target
    unsub
);

export {
    api,
    is,
    sub,
    get
}

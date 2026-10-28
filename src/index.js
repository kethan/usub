const sym = Symbol.observable ||= Symbol('observable');
const registry = new FinalizationRegistry(unsub => unsub());
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

const sub = (target, next, error, cleanup, stop, unsub, emit = v => next?.(get(v))) => is(target) && (
    unsub = (unsub = target[sym]?.() || target).subscribe
        ? (error = unsub.subscribe(emit, error, _ => (cleanup?.(), cleanup = _)) || 1,
            _ => error && (error.call ? error() : error.unsubscribe?.(), error = 0, cleanup?.()))
        : (api.is(target) || target.call)
            ? target.set && target.length && target(emit) || api.any?.(target)?.(next, error, cleanup) || (stop = 1, api.effect?.(_ => (emit(target), api.cleanup?.(cleanup), cleanup)))
            : (target.then
                ? target.then(v => stop || (emit(v), cleanup?.()), error)
                : (async v => {
                    for await (v of target) { if (stop) return; emit(v) }
                    cleanup?.()
                })().then(0, error || is),
                _ => stop = 1),
    stop || (registry.register(target, unsub), target = 0), // effect owned: never park in registry; clear target slot so non-effect closures never retain target
    unsub
);

export {
    api,
    is,
    sub,
    get
}

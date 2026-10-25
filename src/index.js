const sym = Symbol.observable ||= Symbol('observable');
const registry = new FinalizationRegistry(unsub => unsub());
const api = {
    // any: undefined,            // any placeholder
    // cleanup: undefined,        // cleanup placeholder
    effect: f => f(),             // effect placeholder
    is: v => v?.call,             // is placeholder
    get: v => v?.(),              // get placeholder
};
const get = v => api.is(v) ? get(api.get(v)) : v?.call ? get(v()) : v;
const is = arg => arg && !!(
    arg[sym] ||                      // Observable symbol
    arg[Symbol.asyncIterator] ||     // Async iterator
    arg.then ||                      // Promise
    arg.subscribe ||                 // Observable with subscribe method
    api.is(arg) ||                   // Custom observable check
    arg.call                         // Function (including observ-*)
);

const sub = (target, next, error, cleanup, stop, unsub, fx, emit = v => next?.(get(v))) => is(target) && (
    unsub = (unsub = target[sym]?.() || target).subscribe
        ? (error = unsub.subscribe(emit, error, () => (cleanup?.(), cleanup = stop)) || 1,
            () => error && (error.call ? error() : error.unsubscribe?.(), error = 0, cleanup?.()))
        : (api.is(target) || target.call)
            ? target.set && target.call?.(stop, emit) || api.any?.(target)?.(next, error, cleanup) || (fx = 1, api.effect?.(() => (emit(target), api.cleanup?.(cleanup), cleanup)))
            : (target.then?.(v => !stop && (emit(v), cleanup?.()), error) ||
                (async v => {
                    for await (v of target) { if (stop) return; emit(v) }
                    cleanup?.()
                })().then(0, error || is)
            ) && (_ => stop = 1),
    fx || (registry.register(target, unsub), target = 0), // effect owned: never park in registry; clear target slot so non-effect closures never retain target
    unsub
);

export {
    api,
    is,
    sub,
    get
}

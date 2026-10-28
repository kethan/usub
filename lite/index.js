const registry = new FinalizationRegistry(unsub => unsub?.());
const cancel = state => () => state[0] = 1;
const api = {
    // any: undefined,            // any placeholder
    // cleanup: undefined,        // cleanup placeholder
    effect: f => f(),             // effect placeholder
    is: v => v?.call,             // is placeholder
    get: v => v?.(),              // get placeholder
};
const get = v => api.is(v) ? get(api.get(v)) : v?.call ? get(v()) : v;
const is = arg => arg && !!(
    arg[Symbol.asyncIterator] ||     // Async iterator
    arg.then ||                      // Promise
    api.is(arg) ||                   // Custom observable check
    arg.call                         // Function
);

const sub = (target, next, error, cleanup, stop, unsub, fx) => is(target) && (
    unsub = (api.is(target) || target.call)
        ? api.any?.(target)?.(next, error, cleanup) || (fx = api.effect?.(() => (next?.(get(target)), api.cleanup?.(cleanup), cleanup)))
        : (stop = [stop],
            (target.then?.(v => !stop[0] && (next?.(get(v)), cleanup?.()), error) ||
                (async v => {
                    for await (v of target) { if (stop[0]) return; next?.(get(v)) }
                    cleanup?.()
                })().then(0, error || is)
            ) && /*@__NOINLINE__*/ cancel(stop)),
    fx || registry.register(target, unsub),
    unsub
);

export {
    api,
    is,
    sub,
    get
}

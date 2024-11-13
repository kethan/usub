const registry = new FinalizationRegistry(unsub => unsub?.());
const api = {
    // any: undefined,            // any placeholder
    // cleanup: undefined,        // cleanup placeholder
    effect: f => f(),             // effect placeholder
    is: v => v?.call,             // is placeholder
    get: v => v?.(),          // get placeholder
};
const get = v => api.is(v) ? get(api.get(v)) : v?.call ? get(v()) : v;
const is = arg => arg && !!(
    arg[Symbol.asyncIterator] ||     // Async iterator
    arg.then ||                      // Promise
    api.is(arg) ||                   // Custom observable check
    arg.call                         // Function
);
const sub = (target, next, error, cleanup, stop, unsub) => target &&
    (
        unsub =
        ((api.is(target) || target.call) && (
            api.any?.(target)?.(next, error, cleanup) || api.effect?.(() => (next(get(target)), api.cleanup?.(cleanup), cleanup))
        )) ||
        (
            target.then?.(v => (!stop && next(get(v)), cleanup?.()), error) ||
            (async v => {
                try {
                    for await (v of target) { if (stop) return; next(get(v)) }
                    cleanup?.()
                } catch (err) { error?.(err) }
            })()
        ) && (_ => stop = 1),
        registry.register(target, unsub),
        unsub
    );

export {
    api,
    is,
    sub,
    get
}
const
    // FinalizationRegistry to clean up subscriptions when objects are garbage collected
    registry = new FinalizationRegistry(unsub => (unsub && unsub?.call?.())),

    // API object providing basic functions for handling effects and values
    api = {
        // Handle any reactive subscription
        any: undefined,
        // If any cleanup is requested
        cleanup: undefined,
        // Executes the provided function
        effect: (f) => f(),
        // Returns false for any value (placeholder implementation)
        is: (v) => v?.call,
        // Retrieves the value (returns it as is)
        get: (v) => v?.call(),
    },

    // Utility function to handle and unwrap values of signals, observable, etc especially functions
    get = (v) => api.is(v) ? get(api.get(v)) : v?.call ? get(v()) : v,

    // Checks if the argument is considered an observable
    is = (arg) => arg && !!(
        arg[Symbol.asyncIterator] ||     // Async iterator
        arg.then ||                      // Promise
        api.is(arg) ||                   // Custom observable check
        arg.call                         // Function
    ),
    
    // Subscribe to an observable or value, and provide a callback for each value
    sub = (target, stop, unsub) => (next, error, cleanup) => target && (
        unsub = ((!api?.any && (api.is(target) || target?.call)) && api.effect(() => (next(get(target)), api?.cleanup?.(cleanup), cleanup))) ||
        (
            target.then?.(v => (!stop && next(get(v)), cleanup?.()), error) ||
            target[Symbol.asyncIterator] && (async v => {
                try {
                    // FIXME: possible drawback: it will catch error happened in next, not only in iterator
                    for await (v of target) { if (stop) return; next(get(v)) }
                    cleanup?.()
                } catch (err) { error?.(err) }
            })()
        ) && (_ => stop = 1) ||
        (api?.any?.(target)?.(next, error, cleanup)),
        // register autocleanup
        registry.register(target, unsub),
        unsub
    );

export {
    api,
    is,
    sub,
    get
}
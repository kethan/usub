// Ensure the Symbol for observables is defined
Symbol.observable ||= Symbol('observable');

// FinalizationRegistry to clean up subscriptions when objects are garbage collected
const
    registry = new FinalizationRegistry((unsub) => {
        if (!unsub?._) {
            unsub.call?.();
        }
    }),
    // Utility function to handle unsubscription and complete callback
    unsubr = (unsub, complete, out) => (
        unsub && (out = () => (unsub?.call ? unsub() : unsub?.unsubscribe?.(), out._ = true, complete?.()))
    ),

    // API object providing basic functions for handling effects and values
    api = {
        // Executes the provided function
        effect: (f) => f(),

        // Returns false for any value (placeholder implementation)
        is: (v) => false,

        // Retrieves the value (returns it as is)
        get: (v) => v,
    },

    // Utility function to handle and unwrap values, especially functions
    get = (v) => v?.call ? get(v()) : api.is(v) ? get(api.get(v)) : v,

    // Checks if the argument is considered an observable
    is = (arg) => arg && !!(
        arg[Symbol.observable] ||        // Observable symbol
        arg[Symbol.asyncIterator] ||     // Async iterator
        arg?.call ||                     // Function with call method
        arg.then ||                      // Promise
        arg.subscribe ||                 // Observable with subscribe method
        api.is(arg)                      // Custom observable check
    ),

    sub = (target, stop, unsub) => (next, error, complete) => target && (
        unsub = unsubr((target[Symbol.observable]?.() || target).subscribe?.(next, error, complete), complete) ||
        (target.call && !api.is(target) && api.effect(() => next(get(target)))) ||
        (api.is(target) && api.effect(() => next(get(target)))) ||
        (target.then?.(v => (!stop && next(get(v)), complete?.()), error)) ||
        (async v => {
            try {
                for await (v of target) { if (stop) return; next(get(v)) }
                complete?.()
            } catch (err) { error?.(err) }
        })()
        && (_ => stop = 1),
        // register autocleanup
        registry.register(target, unsub),
        unsub
    );

export {
    is,
    api,
    sub,
}
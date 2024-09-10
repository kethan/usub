// Ensure the Symbol for observables is defined
Symbol.observable ||= Symbol('observable');

// FinalizationRegistry to clean up subscriptions when objects are garbage collected
const
    registry = new FinalizationRegistry((unsub) => {
        if (!unsub?._) {
            unsub?.call?.();
        }
    }),
    // Utility function to handle unsubscription and complete callback
    unsubr = (unsub, cleanup, out) => (
        unsub && (out = () => (unsub?.call ? unsub() : unsub?.unsubscribe?.(), out._ = true, cleanup?.()))
    ),

    // API object providing basic functions for handling effects and values
    api = {
        // Handle any reactive subscription
        any: undefined,
        // If any cleanup is requested
        cleanup: undefined,
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
        arg.then ||                      // Promise
        (target?.call && !api?.any) ||                      // Function
        arg.subscribe ||                 // Observable with subscribe method
        api.is(arg)                      // Custom observable check
    ),
    sub = (target, stop, unsub) => (next, error, cleanup) => target && (
        unsub = unsubr((target[Symbol.observable]?.() || target).subscribe?.((v) => next(get(v)), error, cleanup), cleanup) ||
        (((target?.call && !api?.any) || api.is(target)) && api.effect(() => (next(get(target)), api?.cleanup?.(cleanup) || cleanup))) ||
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
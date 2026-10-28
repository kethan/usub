declare global {
	interface SymbolConstructor {
		readonly observable: symbol;
	}
}

export type Unsubscribe = () => any;
export type NextFn<T = any> = (value: T) => any;
export type ErrorFn = (error: any) => any;
export type CleanupFn = () => any;

export interface SubscriptionLike {
	unsubscribe?(): void;
}

export interface Observer<T = any> {
	next?: NextFn<T>;
	error?: ErrorFn;
	complete?: CleanupFn;
}

export interface Subscribable<T = any> {
	subscribe(
		nextOrObserver?: NextFn<T> | Observer<T> | null,
		error?: ErrorFn | null,
		complete?: CleanupFn | null,
	): Unsubscribe | SubscriptionLike | void;
}

export interface InteropObservable<T = any> {
	[Symbol.observable](): Subscribable<T>;
}

export interface ObservLike<T = any> {
	(listener: NextFn<T>): Unsubscribe | void;
	set(value: T): any;
}

export type AnySubscriber<T = any> = (
	next?: NextFn<T> | null,
	error?: ErrorFn | null,
	cleanup?: CleanupFn | null,
) => Unsubscribe | void | undefined;

export interface UsubApi {
	is(value: any): unknown;
	get(target: any): any;
	effect?: ((fn: () => CleanupFn | void | undefined) => Unsubscribe | void) | null;
	cleanup?: ((fn?: CleanupFn | null) => any) | undefined;
	any?: ((target: any) => AnySubscriber | void | undefined | false | null) | undefined;
	[key: string]: unknown;
}

/**
 * Recursively unwraps getter functions and signal/ref containers (`() => T`, `{ get(): T }`, `{ value: T }`).
 */
export type Unwrap<T> = T extends { (): infer R; (value: any): any }
	? Unwrap<R>
	: T extends () => infer R
		? Unwrap<R>
		: T extends { get(): infer R }
			? Unwrap<R>
			: T extends { readonly value: infer R }
				? Unwrap<R>
				: T;

/**
 * Infers the emitted value type for Observables, Promises, AsyncIterables, Signals, Getters, and custom sources.
 */
export type SubValue<T> = T extends {
	subscribe(next: (value: infer V, ...args: any[]) => any, ...args: any[]): any;
}
	? Unwrap<V>
	: T extends { subscribe(observer: { next?: (value: infer V) => any }): any }
		? Unwrap<V>
		: T extends { [Symbol.observable](): infer O }
			? SubValue<O>
			: T extends { (listener: (value: infer V) => any): any; set: (...args: any[]) => any }
				? Unwrap<V>
				: T extends PromiseLike<infer V>
					? Unwrap<V>
					: T extends AsyncIterable<infer V>
						? Unwrap<V>
						: T extends { (): infer R; (value: any): any }
							? Unwrap<R>
							: T extends () => infer R
								? Unwrap<R>
								: T extends { get(): infer R }
									? Unwrap<R>
									: T extends { readonly value: infer R }
										? Unwrap<R>
										: any;

export declare const api: UsubApi;

export declare function is(arg: unknown): boolean;

export declare function get<Value = never, Target = unknown>(
	value: Target,
): [Value] extends [never] ? Unwrap<Target> : Value;

export declare function sub<Value = never, Target = unknown>(
	target: Target,
	next?: NextFn<[Value] extends [never] ? SubValue<Target> : Value> | null,
	error?: ErrorFn | null,
	cleanup?: CleanupFn | null,
): Unsubscribe;

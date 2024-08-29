# USub

[![tests](https://github.com/kethan/usub/actions/workflows/node.js.yml/badge.svg)](https://github.com/kethan/usub/actions/workflows/node.js.yml) [![Version](https://img.shields.io/npm/v/usub.svg?color=success&style=flat-square)](https://www.npmjs.com/package/usub) [![Badge size](https://deno.bundlejs.com/badge?q=usub&treeshake=[*]&config={"compression":"brotli"})](https://unpkg.com/usub/lite) [![Badge size](https://deno.bundlejs.com/badge?q=usub&treeshake=[*]&config={"compression":"gzip"})](https://unpkg.com/usub)


This JavaScript library provides utility functions for handling observables, signals, and asynchronous data streams across various reactive programming libraries. It supports flexible customization to integrate with different libraries, ensuring seamless subscription management and automatic cleanup.

## Table of Contents

-   [Installation](#installation)
-   [Usage](#usage)
    -   [Basic Setup](#basic-setup)
    -   [Promise](#promise)
    -   [Subscribing to Observables](#subscribing-to-observables)
    -   [API Overview](#api-overview)
    -   [Checking if an Object is Observable](#checking-if-an-object-is-observable)
    -   [Customizing for Your Reactive Library](#customizing-for-your-reactive-library)
-   [Examples](#examples)
    -   [Solid.js](#solidjs)
    -   [Preact Signals](#preact-signals)
    -   [uSignal](#usignal)
    -   [@webreflection/signal](#webreflectionsignal)
    -   [uLive](#ulive)
    -   [RxJS Subject](#rxjs-subject)
    -   [Async Iterable](#async-iterable)
    -   [Synchronous Iterable](#synchronous-iterable)
-   [Finalization and Cleanup](#finalization-and-cleanup)
-   [License](#license)
-   [Thanks](#thanks)

## Installation

To use this utility, copy the provided JavaScript file into your project. There are no external dependencies, so no installation via npm or other package managers is required.

## Usage

### Basic Setup

The library exports three primary functions:

-   **`is`**: Checks if a value is considered an observable or reactive signal.
-   **`api`**: Provides utility functions that can be customized to work with different reactive libraries.
-   **`sub`**: Subscribes to an observable or other async/reactive patterns.

Import the functions in your JavaScript file:

```js
import { is, api, sub } from "usub";
```

### Subscribing to Observables
The sub function is used to subscribe to an observable or other async patterns. It handles various types of asynchronous inputs like promises, async iterables, and functions.

```js
const observable = {
    subscribe: (next, error, complete) => {
        next(1);
        next(2);
        next(3);
        complete();
        return {
            unsubscribe: () => console.log('Unsubscribed')
        };
    }
};

const unsubscribe = sub(observable)(console.log, console.error, () => console.log('Complete'));
```
### Checking if an Object is Observable
Use the is function to check if a value is considered an observable by the library:

```js
const observable = {
    subscribe: () => {}
};

console.log(is(observable));  // Output: true
```


### Promise

```js
{
	const promise = new Promise((resolve) => {
		setTimeout(() => {
			resolve("Hello, World!");
		}, 1000);
	});

	sub(promise)(
		(value) => console.log("Resolved value:", value),
		(error) => console.error("Error:", error),
		() => console.log("Promise complete")
	);
}
```

## Customizing for Your Reactive Library

The library is designed to be easily customized for different reactive programming libraries. To integrate with your preferred library, you can customize the following api functions:

### API Overview

- **api.effect(f)**

Sets up the effect execution method. This function is where you define how to apply effects in your reactive library (e.g., createEffect in Solid.js, effect in Preact Signals).

- **api.is(v)**

Defines how to check if a value is a signal or observable. This is where you identify reactive signals from your library (e.g., checking if a value is an instance of Signal).

- **api.get(v)**

Specifies how to retrieve the current value from a signal or observable. This function is where you define how to extract the current value from your reactive signal (e.g., v?.value or v?.()).

### Example API Customization

### Solidjs

```js
const { createSignal, createEffect } = require("solid-js");

api.effect = createEffect;
api.is = (v) => v?.name?.includes("readSignal");
api.get = (v) => v?.();

const [val, setVal] = createSignal(0);

sub(val)(console.log);
setVal(10);
setVal(20);
```

### Preact Signals

```js
const { effect, signal, Signal } = require("@preact/signals-core");

api.effect = effect;
api.is = (v) => v instanceof Signal;
api.get = (v) => v?.value;

const val = signal(0);

const stop = sub(val)((v) => {
	console.log(v);
});

val.value = 10;
val.value = 20;
stop();
val.value = 30;
```

### USignal

```js
const { effect, signal, Signal } = require("usignal");

api.effect = effect;
api.is = (v) => v instanceof Signal;
api.get = (v) => v?.value;

const val = signal(0);

const stop = sub(val)((v) => {
	console.log(v);
});

val.value = 10;
val.value = 20;
stop();
val.value = 30;
```

### @webreflection/signal

```js
const { effect, signal, Signal } = require("@webreflection/signal");

api.effect = effect;
api.is = (v) => v instanceof Signal;
api.get = (v) => v?.value;

const val = signal(0);

const stop = sub(val)((v) => {
	console.log(v);
});

val.value = 10;
val.value = 20;
stop();
val.value = 30;
```

### ULive

```js
const { effect, signal } = require("ulive");

api.effect = effect;
api.is = (v) => v?.peek;
api.get = (v) => v?.value;

const val = signal(0);

const stop = sub(val)((v) => {
	console.log(v);
});

val.value = 10;
val.value = 20;
stop();
val.value = 30;
```

### RxJS

```js
const { Subject } = require("rxjs");
const subject = new Subject();

let arr = [];
const unsub = sub(subject)(
	(v) => arr.push(v),
	(err) => arr.push(err),
	() => arr.push("end")
);

subject.next(1);
subject.next(2);
subject.complete();
console.log(arr);

unsub();
```

### Async Iterable

```js
const asyncIterable = {
	[Symbol.asyncIterator]() {
		return {
			i: 0,
			next() {
				if (this.i < 5)
					return new Promise((ok) =>
						setTimeout(
							() =>
								ok({
									value: this.i++,
									done: false,
								}),
							10
						)
					);
				return new Promise((ok) => ok({ done: true }));
			},
		};
	},
};

sub(asyncIterable)(console.log, console.error, () => console.log("end"));
```

### Synchronous Iterable

```js
const myIterable = {
	[Symbol.iterator]() {
		let step = 10;
		return {
			next() {
				if (step++ <= 13) {
					return { value: step, done: false };
				} else {
					return { value: undefined, done: true };
				}
			},
		};
	},
};

for (const value of myIterable) {
	console.log(value);
}
```

### Finalization and Cleanup

The library uses FinalizationRegistry to automatically clean up subscriptions when objects are garbage collected. This helps prevent memory leaks by ensuring that subscriptions are properly terminated when no longer needed.

### License

This library is provided "as-is" under the MIT license. Feel free to use, modify, and distribute it in your projects.

### Thanks and Inspiration

-   **[dy](https://github.com/dy)**

import { api, get, is, sub } from "usub";
import type {
	AnySubscriber,
	InteropObservable,
	ObservLike,
	Subscribable,
	Unsubscribe,
	UsubApi,
} from "usub";
import { api as liteApi, get as liteGet, is as liteIs, sub as liteSub } from "usub/lite";
import { api as tinyApi, get as tinyGet, is as tinyIs, sub as tinySub } from "usub/tiny";

import { signal as preactSignal, computed as preactComputed } from "@preact/signals-core";
import { signal as alienSignal, computed as alienComputed, effect as alienEffect } from "alien-signals";
import { ref as vueRef, computed as vueComputed } from "@vue/reactivity";
import { atom as nanoAtom } from "nanostores";
import { createStore as createTanStackStore } from "@tanstack/store";
import { Subject, BehaviorSubject } from "rxjs";

function expectType<Value>(_value: Value): void {}

// 1. Entry-point API parity
expectType<UsubApi>(api);
expectType<UsubApi>(liteApi);
expectType<UsubApi>(tinyApi);
expectType<boolean>(is(null));
expectType<boolean>(liteIs(Promise.resolve(1)));
expectType<boolean>(tinyIs(() => 1));

// 2. Recursive get() unwrapping
expectType<number>(get(42));
expectType<string>(get(() => () => "hello"));
expectType<boolean>(liteGet(() => true));
expectType<number>(tinyGet(() => () => () => 7));
expectType<{ id: number }>(get<{ id: number }>({ raw: true }));

// 3. Promises & nested Promises/Getters
const offPromise = sub(
	Promise.resolve(123),
	(v) => {
		expectType<number>(v);
	},
	(err) => {
		expectType<any>(err);
	},
	() => {},
);
expectType<Unsubscribe>(offPromise);
offPromise();

sub(Promise.resolve(() => "nested"), (v) => {
	expectType<string>(v);
});
sub(Promise.resolve(1), null, (e) => expectType<any>(e), null);

// 4. AsyncIterables
async function* streamStrings(): AsyncGenerator<string> {
	yield "a";
}
sub(streamStrings(), (chunk) => {
	expectType<string>(chunk);
});
liteSub(streamStrings(), (chunk) => {
	expectType<string>(chunk);
});

// 5. Observables (.subscribe & Symbol.observable) and ObservLike
const customObs: Subscribable<{ ok: boolean }> = {
	subscribe(next) {
		if (typeof next === "function") next({ ok: true });
		return { unsubscribe() {} };
	},
};
sub(customObs, (val) => {
	expectType<{ ok: boolean }>(val);
});

const interopObs: InteropObservable<number> = {
	[Symbol.observable]() {
		return {
			subscribe(next) {
				if (typeof next === "function") next(99);
			},
		};
	},
};
sub(interopObs, (n) => {
	expectType<number>(n);
});

declare const observCell: ObservLike<Date>;
sub(observCell, (d) => {
	expectType<Date>(d);
});

// 6. Real third-party libraries inference
const rxSubject = new Subject<{ count: number }>();
sub(rxSubject, (msg) => {
	expectType<{ count: number }>(msg);
});

const rxBehavior = new BehaviorSubject<string>("init");
sub(rxBehavior, (s) => {
	expectType<string>(s);
});

const pSig = preactSignal(10);
const pComp = preactComputed(() => pSig.value * 2);
expectType<number>(get(pSig));
expectType<number>(get(pComp));
sub(pSig, (v) => expectType<number>(v));
sub(pComp, (v) => expectType<number>(v));
liteSub(pSig, (v) => expectType<number>(v));
tinySub(pComp, (v) => expectType<number>(v));

const aSig = alienSignal("alien");
const aComp = alienComputed(() => aSig().length);
expectType<string>(get(aSig));
expectType<number>(get(aComp));
sub(aSig, (v) => expectType<string>(v));
sub(aComp, (v) => expectType<number>(v));
tinySub(aSig, (v) => expectType<string>(v));

const vRef = vueRef(true);
const vComp = vueComputed(() => (vRef.value ? "yes" : "no"));
expectType<boolean>(get(vRef));
expectType<string>(get(vComp));
sub(vRef, (v) => expectType<boolean>(v));
sub(vComp, (v) => expectType<string>(v));

const nAtom = nanoAtom(42);
expectType<number>(get(nAtom));
sub(nAtom, (v) => expectType<number>(v));

const tStore = createTanStackStore({ user: "Ada" });
expectType<{ user: string }>(get(tStore));
sub(tStore, (v) => expectType<{ user: string }>(v));

// 7. Configuring `api` (effect, cleanup, is, get, any)
Object.assign(api, {
	is: (v: unknown) => typeof v === "function",
	get: (v: () => unknown) => v(),
	effect: alienEffect,
	cleanup: (fn?: (() => void) | null) => fn?.(),
	any: (target: unknown): AnySubscriber | undefined => {
		if (target instanceof EventTarget) {
			return (next, _error, cleanup) => {
				const listener = (ev: Event) => next?.(ev);
				target.addEventListener("message", listener);
				return () => {
					target.removeEventListener("message", listener);
					cleanup?.();
				};
			};
		}
	},
});

// 8. Custom `api.any` targets: untyped defaults to `any`, explicit `<Payload>` types `next`
interface WsFrame {
	type: "tick";
	price: number;
}
const rawSocket = new EventTarget();
sub(rawSocket, (untypedMsg) => {
	expectType<any>(untypedMsg);
});
sub<WsFrame>(rawSocket, (frame) => {
	expectType<WsFrame>(frame);
});
liteSub<WsFrame>(rawSocket, (frame) => {
	expectType<WsFrame>(frame);
});
tinySub<WsFrame>(rawSocket, (frame) => {
	expectType<WsFrame>(frame);
});

// 9. Negative type checks
sub(Promise.resolve(123), (v) => {
	// @ts-expect-error number is not assignable to string
	const wrong: string = v;
	void wrong;
});

sub<WsFrame>(rawSocket, (frame) => {
	// @ts-expect-error unknown property on WsFrame
	void frame.nonExistentProp;
});

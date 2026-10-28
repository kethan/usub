import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it } from "vitest";
import { api, get, is, sub } from "../src/index.js";
import { api as liteApi, get as liteGet, is as liteIs, sub as liteSub } from "../lite/index.js";
import { api as tinyApi, get as tinyGet, is as tinyIs, sub as tinySub } from "../tiny/index.js";
import { createApiResetter, gc, tick, time } from "./helpers.js";

const resetAllApis = createApiResetter(api, liteApi, tinyApi);
const noop = () => {};

/**
 * Helper to install a protocol router on a given `api` object (`api`, `liteApi`, or `tinyApi`).
 * Each entry is `[predicate, (target, next, error, cleanup) => unsubFn]`.
 */
function installRouter(apiObj, routes, { isSignal, getSignal } = {}) {
	apiObj.is = (v) =>
		Boolean(isSignal?.(v) || routes.some(([match]) => match(v)));
	if (getSignal) {
		apiObj.get = (v) => (isSignal?.(v) ? getSignal(v) : v?.());
	}
	apiObj.any = (target) => {
		for (const [match, handler] of routes) {
			if (match(target)) {
				return (next, error, cleanup) =>
					handler(target, next, error, cleanup) || noop;
			}
		}
	};
}

describe("exploiting api.any — 40 ways & combinations", () => {
	beforeEach(() => {
		resetAllApis();
	});

	// =========================================================================
	// GROUP 1: Recreating & Backporting Core Reactive Primitives (1–8)
	// =========================================================================
	describe("1. recreating & backporting core reactive primitives", () => {
		it("01. recreates custom Promise-like Deferred ({ wait }) with cancellation before settle", async () => {
			function createDeferred() {
				const listeners = new Set();
				let state = "pending";
				let outcome;
				return {
					__deferred: true,
					resolve(v) {
						if (state !== "pending") return;
						state = "fulfilled";
						outcome = v;
						for (const l of listeners) l.ok(v);
						listeners.clear();
					},
					reject(e) {
						if (state !== "pending") return;
						state = "rejected";
						outcome = e;
						for (const l of listeners) l.fail(e);
						listeners.clear();
					},
					wait(ok, fail) {
						if (state === "fulfilled") {
							ok(outcome);
							return noop;
						}
						if (state === "rejected") {
							fail(outcome);
							return noop;
						}
						const entry = { ok, fail };
						listeners.add(entry);
						return () => listeners.delete(entry);
					},
				};
			}

			installRouter(api, [
				[
					(t) => t?.__deferred,
					(d, next, error, cleanup) =>
						d.wait(
							(v) => {
								next?.(get(v));
								cleanup?.();
							},
							(e) => error?.(e),
						),
				],
			]);

			const log = [];
			const d1 = createDeferred();
			sub(d1, (v) => log.push(["next", v]), (e) => log.push(["err", e]), () => log.push("done"));
			d1.resolve(() => 42);
			expect(log).toEqual([["next", 42], "done"]);

			const d2 = createDeferred();
			const off2 = sub(d2, (v) => log.push(["d2", v]), null, () => log.push("d2-done"));
			off2();
			d2.resolve(99);
			expect(log).toEqual([["next", 42], "done"]);

			const d3 = createDeferred();
			sub(d3, null, (e) => log.push(["err", e.message]), () => log.push("d3-done"));
			d3.reject(new Error("boom"));
			expect(log).toEqual([["next", 42], "done", ["err", "boom"]]);
		});

		it("02. polyfills AsyncIterable / async generators into 288-byte usub/tiny with iterator.return() teardown", async () => {
			installRouter(tinyApi, [
				[
					(t) => typeof t?.[Symbol.asyncIterator] === "function",
					(iterable, next, error, cleanup) => {
						let cancelled = false;
						const iter = iterable[Symbol.asyncIterator]();
						(async () => {
							try {
								while (!cancelled) {
									const { value, done } = await iter.next();
									if (cancelled) return;
									if (done) {
										cleanup?.();
										return;
									}
									next?.(tinyGet(value));
								}
							} catch (err) {
								if (!cancelled) error?.(err);
							}
						})();
						return () => {
							if (!cancelled) {
								cancelled = true;
								iter.return?.();
							}
						};
					},
				],
			]);

			let finallyRan = false;
			async function* counter() {
				try {
					yield 10;
					await time(5);
					yield () => 20;
					await time(30);
					yield 30;
				} finally {
					finallyRan = true;
				}
			}

			const out = [];
			const gen = counter();
			expect(tinyIs(gen)).toBe(true);
			const off = tinySub(gen, (v) => out.push(v), null, () => out.push("end"));
			await time(15);
			expect(out).toEqual([10, 20]);
			off();
			await time(25);
			expect(finallyRan).toBe(true);
			expect(out).toEqual([10, 20]);
		});

		it("03. polyfills RxJS Observable & Symbol.observable into usub/lite and usub/tiny", async () => {
			const { Subject } = await import("rxjs");
			const obsSym = Symbol.observable || Symbol.for("observable");

			for (const [apiObj, subFn, getFn] of [
				[liteApi, liteSub, liteGet],
				[tinyApi, tinySub, tinyGet],
			]) {
				installRouter(apiObj, [
					[
						(t) => Boolean(t?.subscribe || t?.[obsSym]),
						(target, next, error, cleanup) => {
							const obs = target[obsSym]?.() || target;
							let done = false;
							let subscription = obs.subscribe({
								next: (v) => !done && next?.(getFn(v)),
								error: (e) => {
									if (!done) {
										done = true;
										error?.(e);
									}
								},
								complete: () => {
									if (!done) {
										done = true;
										cleanup?.();
									}
								},
							});
							return () => {
								if (done) return;
								done = true;
								if (typeof subscription === "function") subscription();
								else subscription?.unsubscribe?.();
								subscription = null;
								cleanup?.();
							};
						},
					],
				]);

				const subj = new Subject();
				const seen = [];
				const off = subFn(subj, (v) => seen.push(v), null, () => seen.push("end"));
				subj.next(1);
				subj.next(() => 2);
				off();
				off(); // idempotent
				subj.next(3);
				expect(seen).toEqual([1, 2, "end"]);
			}
		});

		it("04. polyfills observ / observable (callable + .set) into usub/lite & usub/tiny", async () => {
			const { default: Observ } = await import("observ");

			tinyApi.any = (target) =>
				target?.set && target.length
					? (next, _err, cleanup) => {
							const stopListening = target((v) => next?.(tinyGet(v)));
							return () => {
								stopListening?.();
								cleanup?.();
							};
						}
					: undefined;

			const state = Observ("a");
			const log = [];
			const off = tinySub(state, (v) => log.push(v), null, () => log.push("closed"));
			state.set("b");
			state.set("c");
			off();
			state.set("d");
			expect(log).toEqual(["b", "c", "closed"]);
		});

		it("05. adapts Node-style error-first CPS thunks (cb => fn((err, val) => ...))", async () => {
			const cps = (fn) => Object.assign(fn, { __cps: true });

			api.any = (target) =>
				target?.__cps
					? (next, error, cleanup) => {
							let cancelled = false;
							target((err, val) => {
								if (cancelled) return;
								if (err) error?.(err);
								else {
									next?.(get(val));
									cleanup?.();
								}
							});
							return () => {
								cancelled = true;
							};
						}
					: undefined;

			const events = [];
			const okThunk = cps((cb) => setTimeout(() => cb(null, "file-contents"), 5));
			const errThunk = cps((cb) => setTimeout(() => cb(new Error("ENOENT")), 5));

			sub(okThunk, (v) => events.push(v), (e) => events.push(e.message), () => events.push("eof"));
			sub(errThunk, (v) => events.push(v), (e) => events.push(e.message), () => events.push("eof2"));
			await time(20);
			expect(events).toEqual(["file-contents", "eof", "ENOENT"]);
		});

		it("06. drives lazy cold tasks with automatic AbortSignal cancellation on unsub()", async () => {
			const task = (run) => ({ __coldTask: true, run });

			installRouter(api, [
				[
					(t) => t?.__coldTask,
					(t, next, error, cleanup) => {
						const ac = new AbortController();
						t.run(ac.signal, (v) => !ac.signal.aborted && next?.(v))
							.then(() => !ac.signal.aborted && cleanup?.())
							.catch((e) => !ac.signal.aborted && error?.(e));
						return () => ac.abort("unsubscribed");
					},
				],
			]);

			let abortedReason = null;
			const job = task(async (signal, emit) => {
				signal.addEventListener("abort", () => {
					abortedReason = signal.reason;
				});
				emit("step-1");
				await time(30);
				emit("step-2");
			});

			const log = [];
			const off = sub(job, (v) => log.push(v), null, () => log.push("done"));
			await time(8);
			off();
			await time(30);
			expect(log).toEqual(["step-1"]);
			expect(abortedReason).toBe("unsubscribed");
		});

		it("07. streams synchronous Iterable / Generator* sources with mid-iteration stop", () => {
			installRouter(api, [
				[
					(t) => t && typeof t !== "string" && typeof t[Symbol.iterator] === "function",
					(iterable, next, error, cleanup) => {
						let stopped = false;
						const stop = () => {
							stopped = true;
						};
						queueMicrotask(() => {
							try {
								for (const item of iterable) {
									if (stopped) return;
									next?.(item, stop);
								}
								if (!stopped) cleanup?.();
							} catch (e) {
								if (!stopped) error?.(e);
							}
						});
						return stop;
					},
				],
			]);

			function* naturals() {
				let n = 1;
				while (true) yield n++;
			}

			const collected = [];
			let off;
			off = sub(naturals(), (v) => {
				collected.push(v);
				if (v === 4) off();
			});

			return tick(2).then(() => {
				expect(collected).toEqual([1, 2, 3, 4]);
			});
		});

		it("08. intercepts tagged native Promises BEFORE built-in .then to add deadline timeouts", async () => {
			const withDeadline = (promise, ms) => Object.assign(promise, { __deadlineMs: ms });

			installRouter(api, [
				[
					(t) => typeof t?.__deadlineMs === "number" && typeof t?.then === "function",
					(p, next, error, cleanup) => {
						let done = false;
						const timer = setTimeout(() => {
							if (!done) {
								done = true;
								error?.(new Error(`Timeout after ${p.__deadlineMs}ms`));
							}
						}, p.__deadlineMs);
						p.then(
							(v) => {
								if (done) return;
								done = true;
								clearTimeout(timer);
								next?.(v);
								cleanup?.();
							},
							(e) => {
								if (done) return;
								done = true;
								clearTimeout(timer);
								error?.(e);
							},
						);
						return () => {
							done = true;
							clearTimeout(timer);
						};
					},
				],
			]);

			const log = [];
			const slow = withDeadline(new Promise((r) => setTimeout(() => r("late"), 40)), 10);
			const fast = withDeadline(new Promise((r) => setTimeout(() => r("on-time"), 5)), 40);

			sub(slow, (v) => log.push(v), (e) => log.push(e.message));
			sub(fast, (v) => log.push(v), (e) => log.push(e.message), () => log.push("fast-done"));

			await time(25);
			expect(log).toEqual(["on-time", "fast-done", "Timeout after 10ms"]);
		});
	});

	// =========================================================================
	// GROUP 2: Sockets, Channels, Events & Real I/O Protocols (9–17)
	// =========================================================================
	describe("2. sockets, channels, events & real I/O protocols", () => {
		function createMockWebSocket() {
			const target = new EventTarget();
			const sock = {
				__ws: true,
				readyState: 1, // OPEN
				sent: [],
				closeCalls: 0,
				send(data) {
					this.sent.push(data);
				},
				addEventListener: target.addEventListener.bind(target),
				removeEventListener: target.removeEventListener.bind(target),
				serverSend(payload) {
					if (this.readyState !== 1) return;
					target.dispatchEvent(new MessageEvent("message", { data: payload }));
				},
				serverError(err) {
					target.dispatchEvent(Object.assign(new Event("error"), { error: err }));
				},
				close(code = 1000) {
					if (this.readyState === 3) return;
					this.readyState = 3; // CLOSED
					this.closeCalls++;
					target.dispatchEvent(Object.assign(new Event("close"), { code }));
				},
			};
			return sock;
		}

		it("09. subscribes to a WebSocket (JSON auto-parse, error forwarding, server close -> cleanup, unsub -> ws.close)", () => {
			installRouter(api, [
				[
					(t) => t?.__ws,
					(ws, next, error, cleanup) => {
						if (ws.readyState === 3) {
							cleanup?.();
							return noop;
						}
						let active = true;
						const onMsg = (ev) => {
							try {
								next?.(typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data);
							} catch (e) {
								error?.(e);
							}
						};
						const onErr = (ev) => error?.(ev.error || new Error("ws error"));
						const onClose = () => {
							if (!active) return;
							active = false;
							detach();
							cleanup?.();
						};
						const detach = () => {
							ws.removeEventListener("message", onMsg);
							ws.removeEventListener("error", onErr);
							ws.removeEventListener("close", onClose);
						};
						ws.addEventListener("message", onMsg);
						ws.addEventListener("error", onErr);
						ws.addEventListener("close", onClose);
						return () => {
							if (!active) return;
							active = false;
							detach();
							ws.close(1000);
						};
					},
				],
			]);

			const ws1 = createMockWebSocket();
			const frames = [];
			const errors = [];
			let closed = 0;

			const off1 = sub(
				ws1,
				(msg) => frames.push(msg),
				(err) => errors.push(err.message),
				() => closed++,
			);

			ws1.serverSend('{"type":"tick","price":101}');
			ws1.serverSend("{bad-json");
			ws1.serverSend('{"type":"tick","price":102}');
			expect(frames).toEqual([
				{ type: "tick", price: 101 },
				{ type: "tick", price: 102 },
			]);
			expect(errors).toHaveLength(1);

			off1();
			expect(ws1.readyState).toBe(3);
			expect(ws1.closeCalls).toBe(1);
			expect(closed).toBe(0); // manual client off detached before server close callback

			// Server-initiated close triggers cleanup:
			const ws2 = createMockWebSocket();
			sub(ws2, (m) => frames.push(m), null, () => closed++);
			ws2.close(1001);
			expect(closed).toBe(1);
		});

		it("10. builds an auto-reconnecting WebSocket session behind a single sub() handle", async () => {
			const sockets = [];
			const createReconnectingSocket = () => ({
				__reconnectingWs: true,
				connect() {
					const ws = createMockWebSocket();
					sockets.push(ws);
					return ws;
				},
			});

			installRouter(api, [
				[
					(t) => t?.__reconnectingWs,
					(descriptor, next, error) => {
						let stopped = false;
						let current = null;
						let retryTimer = null;

						const open = () => {
							if (stopped) return;
							current = descriptor.connect();
							current.addEventListener("message", (e) => !stopped && next?.(e.data));
							current.addEventListener("error", (e) => !stopped && error?.(e.error));
							current.addEventListener("close", () => {
								if (!stopped) retryTimer = setTimeout(open, 5);
							});
						};
						open();

						return () => {
							stopped = true;
							clearTimeout(retryTimer);
							current?.close();
						};
					},
				],
			]);

			const received = [];
			const off = sub(createReconnectingSocket(), (v) => received.push(v));
			expect(sockets).toHaveLength(1);
			sockets[0].serverSend("msg-1");
			sockets[0].close(1006); // unexpected drop!

			await time(12);
			expect(sockets).toHaveLength(2);
			sockets[1].serverSend("msg-2-after-reconnect");

			off();
			await time(12);
			expect(sockets).toHaveLength(2); // no more reconnects after off()
			expect(received).toEqual(["msg-1", "msg-2-after-reconnect"]);
		});

		it("11. subscribes to a real Web MessageChannel / MessagePort duplex pair", async () => {
			installRouter(api, [
				[
					(t) => typeof MessagePort !== "undefined" && t instanceof MessagePort,
					(port, next, error, cleanup) => {
						const onMessage = (e) => next?.(e.data);
						const onError = (e) => error?.(e);
						port.addEventListener("message", onMessage);
						port.addEventListener("messageerror", onError);
						port.start();
						return () => {
							port.removeEventListener("message", onMessage);
							port.removeEventListener("messageerror", onError);
							port.close();
							cleanup?.();
						};
					},
				],
			]);

			const { port1, port2 } = new MessageChannel();
			const inbox = [];
			const off = sub(port1, (msg) => inbox.push(msg), null, () => inbox.push("port-closed"));

			port2.postMessage({ hello: "world" });
			port2.postMessage([1, 2, 3]);
			await time(15);
			expect(inbox).toEqual([{ hello: "world" }, [1, 2, 3]]);

			off();
			port2.close();
			expect(inbox).toEqual([{ hello: "world" }, [1, 2, 3], "port-closed"]);
		});

		it("12. subscribes to a real BroadcastChannel pub/sub topic across peers", async () => {
			installRouter(api, [
				[
					(t) => typeof BroadcastChannel !== "undefined" && t instanceof BroadcastChannel,
					(bc, next, error, cleanup) => {
						const onMsg = (ev) => next?.(ev.data);
						const onErr = (ev) => error?.(ev);
						bc.addEventListener("message", onMsg);
						bc.addEventListener("messageerror", onErr);
						return () => {
							bc.removeEventListener("message", onMsg);
							bc.removeEventListener("messageerror", onErr);
							bc.close();
							cleanup?.();
						};
					},
				],
			]);

			const topic = `usub-bc-${Math.random().toString(36).slice(2)}`;
			const subscriber = new BroadcastChannel(topic);
			const publisher = new BroadcastChannel(topic);

			const log = [];
			const off = sub(subscriber, (v) => log.push(v), null, () => log.push("left"));

			publisher.postMessage("ping");
			publisher.postMessage("pong");
			await time(15);
			expect(log).toEqual(["ping", "pong"]);

			off();
			publisher.close();
			expect(log).toEqual(["ping", "pong", "left"]);
		});

		it("13. adapts Node EventEmitter via tuple descriptor [emitter, eventName]", () => {
			installRouter(api, [
				[
					(t) => Array.isArray(t) && t[0] instanceof EventEmitter && typeof t[1] === "string",
					([ee, event, endEvent = "end"], next, error, cleanup) => {
						const onData = (v) => next?.(v);
						const onErr = (e) => {
							detach();
							error?.(e);
						};
						const onEnd = () => {
							detach();
							cleanup?.();
						};
						const detach = () => {
							ee.off(event, onData);
							ee.off("error", onErr);
							ee.off(endEvent, onEnd);
						};
						ee.on(event, onData);
						ee.on("error", onErr);
						ee.on(endEvent, onEnd);
						return detach;
					},
				],
			]);

			const bus = new EventEmitter();
			const log = [];
			const off = sub([bus, "metric"], (v) => log.push(v), (e) => log.push(e.message), () => log.push("end"));

			bus.emit("metric", 10);
			bus.emit("metric", 20);
			expect(bus.listenerCount("metric")).toBe(1);
			bus.emit("end");
			expect(bus.listenerCount("metric")).toBe(0);
			expect(log).toEqual([10, 20, "end"]);
			off();
		});

		it("14. adapts Web EventTarget + CustomEvent descriptor ({ target, type }) using AbortController listener cleanup", () => {
			installRouter(api, [
				[
					(t) => t?.target instanceof EventTarget && typeof t.type === "string",
					({ target, type }, next, _err, cleanup) => {
						const ac = new AbortController();
						target.addEventListener(type, (ev) => next?.(ev.detail ?? ev), {
							signal: ac.signal,
						});
						return () => {
							if (!ac.signal.aborted) {
								ac.abort();
								cleanup?.();
							}
						};
					},
				],
			]);

			const dom = new EventTarget();
			const clicks = [];
			const off = sub({ target: dom, type: "action" }, (d) => clicks.push(d), null, () => clicks.push("detached"));

			dom.dispatchEvent(new CustomEvent("action", { detail: { id: 1 } }));
			dom.dispatchEvent(new CustomEvent("action", { detail: { id: 2 } }));
			off();
			dom.dispatchEvent(new CustomEvent("action", { detail: { id: 3 } }));

			expect(clicks).toEqual([{ id: 1 }, { id: 2 }, "detached"]);
		});

		it("15. subscribes to a Node stream.PassThrough / Readable stream", async () => {
			// PassThrough also exposes [Symbol.asyncIterator] in Node, and `(api.is || target.call)`
			// runs BEFORE `[Symbol.asyncIterator]` in `src` and `lite` — so `api.any` takes control!
			installRouter(api, [
				[
					(t) => t instanceof PassThrough,
					(stream, next, error, cleanup) => {
						const onData = (chunk) => next?.(chunk.toString("utf8"));
						const onErr = (err) => error?.(err);
						const onEnd = () => cleanup?.();
						stream.on("data", onData);
						stream.on("error", onErr);
						stream.on("end", onEnd);
						return () => {
							stream.off("data", onData);
							stream.off("error", onErr);
							stream.off("end", onEnd);
							stream.destroy();
						};
					},
				],
			]);

			const pt = new PassThrough();
			const chunks = [];
			sub(pt, (c) => chunks.push(c), null, () => chunks.push("EOF"));

			pt.write("hello ");
			pt.write("stream");
			pt.end();
			await time(10);
			expect(chunks).toEqual(["hello ", "stream", "EOF"]);
		});

		it("16. pumps a Web ReadableStream via getReader() inside usub/tiny (where AsyncIterator is stripped)", async () => {
			installRouter(tinyApi, [
				[
					(t) => typeof ReadableStream !== "undefined" && t instanceof ReadableStream,
					(rs, next, error, cleanup) => {
						const reader = rs.getReader();
						let cancelled = false;
						(async () => {
							try {
								while (!cancelled) {
									const { value, done } = await reader.read();
									if (cancelled) return;
									if (done) {
										cleanup?.();
										return;
									}
									next?.(value);
								}
							} catch (e) {
								if (!cancelled) error?.(e);
							}
						})();
						return () => {
							cancelled = true;
							reader.cancel("unsub").catch(noop);
						};
					},
				],
			]);

			let cancelReason = null;
			const stream = new ReadableStream({
				start(controller) {
					controller.enqueue("chunk-1");
					controller.enqueue("chunk-2");
				},
				cancel(reason) {
					cancelReason = reason;
				},
			});

			const out = [];
			const off = tinySub(stream, (v) => out.push(v));
			await tick(4);
			expect(out).toEqual(["chunk-1", "chunk-2"]);
			off();
			await tick(3);
			expect(cancelReason).toBe("unsub");
		});

		it("17. treats Web AbortSignal (live or already-aborted) as a reactive cancellation source", () => {
			installRouter(api, [
				[
					(t) => typeof AbortSignal !== "undefined" && t instanceof AbortSignal,
					(sig, next, error, cleanup) => {
						if (sig.aborted) {
							error ? error(sig.reason) : next?.(sig.reason);
							cleanup?.();
							return noop;
						}
						const onAbort = () => {
							error ? error(sig.reason) : next?.(sig.reason);
							cleanup?.();
						};
						sig.addEventListener("abort", onAbort, { once: true });
						return () => sig.removeEventListener("abort", onAbort);
					},
				],
			]);

			const log = [];
			const ac1 = new AbortController();
			sub(ac1.signal, null, (r) => log.push(["live", r]), () => log.push("live-end"));
			ac1.abort("manual-stop");

			const already = AbortSignal.abort("already-stopped");
			sub(already, null, (r) => log.push(["pre", r]), () => log.push("pre-end"));

			expect(log).toEqual([
				["live", "manual-stop"],
				"live-end",
				["pre", "already-stopped"],
				"pre-end",
			]);
		});
	});

	// =========================================================================
	// GROUP 3: Custom Signal Libraries, Stores & State Machines (18–26)
	// =========================================================================
	describe("3. custom signal libraries, stores & state machines", () => {
		it("18. builds a complete custom Signal + Computed graph driven purely by api.any (without api.effect)", () => {
			let activeTracker = null;

			function createSignal(initial) {
				let value = initial;
				const subs = new Set();
				return {
					__sig: true,
					read() {
						if (activeTracker) subs.add(activeTracker);
						return value;
					},
					write(nextVal) {
						if (Object.is(value, nextVal)) return;
						value = nextVal;
						for (const fn of [...subs]) fn();
					},
					off(fn) {
						subs.delete(fn);
					},
				};
			}

			function createComputed(computeFn) {
				const inner = createSignal(undefined);
				const recompute = () => {
					const prev = activeTracker;
					activeTracker = recompute;
					try {
						inner.write(computeFn());
					} finally {
						activeTracker = prev;
					}
				};
				recompute();
				return {
					__sig: true,
					read: () => inner.read(),
					off: (fn) => inner.off(fn),
				};
			}

			api.effect = null; // prove api.effect is NOT used at all!
			api.is = (v) => Boolean(v?.__sig);
			api.get = (v) => v.read();
			api.any = (target) =>
				target?.__sig
					? (next, error, cleanup) => {
							const notify = () => {
								try {
									const prev = activeTracker;
									activeTracker = notify;
									let val;
									try {
										val = get(target);
									} finally {
										activeTracker = prev;
									}
									next?.(val);
								} catch (e) {
									error?.(e);
								}
							};
							notify();
							return () => {
								target.off(notify);
								cleanup?.();
							};
						}
					: undefined;

			const a = createSignal(2);
			const b = createSignal(3);
			const sum = createComputed(() => a.read() + b.read());

			const values = [];
			const off = sub(sum, (v) => values.push(v), null, () => values.push("disposed"));
			expect(values).toEqual([5]);
			a.write(10);
			b.write(20);
			expect(values).toEqual([5, 13, 30]);
			off();
			a.write(99);
			expect(values).toEqual([5, 13, 30, "disposed"]);
		});

		it("19. hybrid coexistence: api.any handles EventEmitters while returning undefined so Signals fall through to api.effect", () => {
			let currentEffect = null;
			function miniSignal(v) {
				const deps = new Set();
				return {
					__miniSig: true,
					get value() {
						if (currentEffect) deps.add(currentEffect);
						return v;
					},
					set value(nv) {
						v = nv;
						for (const e of [...deps]) e();
					},
				};
			}

			api.is = (v) => Boolean(v?.__miniSig || v instanceof EventEmitter);
			api.get = (v) => (v?.__miniSig ? v.value : v?.());
			api.effect = (fn) => {
				let cleanupFn;
				let stopped = false;
				const run = () => {
					if (stopped) return;
					cleanupFn?.();
					currentEffect = run;
					cleanupFn = fn();
					currentEffect = null;
				};
				run();
				return () => {
					stopped = true;
					cleanupFn?.();
				};
			};
			// api.any ONLY handles EventEmitter; returns undefined for miniSignal!
			api.any = (target) =>
				target instanceof EventEmitter
					? (next) => {
							const fn = (v) => next?.(get(v));
							target.on("push", fn);
							return () => target.off("push", fn);
						}
					: undefined;

			const sig = miniSignal(10);
			const bus = new EventEmitter();
			const log = [];

			const offSig = sub(sig, (v) => log.push(["sig", v]), null, () => log.push("sig-clean"));
			const offBus = sub(bus, (v) => log.push(["bus", v]));

			sig.value = 20;
			bus.emit("push", miniSignal(99)); // emits a signal over EventEmitter -> unwrapped by get()!

			offSig();
			offBus();
			sig.value = 30;
			bus.emit("push", 100);

			expect(log).toEqual([
				["sig", 10],
				"sig-clean",
				["sig", 20],
				["bus", 99],
				"sig-clean",
			]);
		});

		it("20. subscribes to a Redux / Zustand store selector [store, selector] with Object.is deduplication", () => {
			function createStore(reducer, init) {
				let state = init;
				const listeners = new Set();
				return {
					__redux: true,
					getState: () => state,
					dispatch(action) {
						state = reducer(state, action);
						for (const l of listeners) l();
					},
					subscribe(l) {
						listeners.add(l);
						return () => listeners.delete(l);
					},
				};
			}

			installRouter(api, [
				[
					(t) => Array.isArray(t) && t[0]?.__redux && typeof t[1] === "function",
					([store, selector], next, _err, cleanup) => {
						let prev = selector(store.getState());
						next?.(prev);
						const unsubStore = store.subscribe(() => {
							const curr = selector(store.getState());
							if (!Object.is(prev, curr)) {
								prev = curr;
								next?.(curr);
							}
						});
						return () => {
							unsubStore();
							cleanup?.();
						};
					},
				],
			]);

			const store = createStore(
				(s, a) =>
					a.type === "INC"
						? { ...s, count: s.count + 1 }
						: { ...s, unrelated: a.val },
				{ count: 0, unrelated: "x" },
			);

			const selected = [];
			const off = sub([store, (s) => s.count], (c) => selected.push(c));
			store.dispatch({ type: "OTHER", val: "y" }); // deduplicated!
			store.dispatch({ type: "OTHER", val: "z" }); // deduplicated!
			store.dispatch({ type: "INC" });
			store.dispatch({ type: "INC" });
			off();
			store.dispatch({ type: "INC" });

			expect(selected).toEqual([0, 1, 2]);
		});

		it("21. turns an ES Proxy object into a live reactive source emitting mutation snapshots", () => {
			const listenersSym = Symbol("proxyListeners");

			function reactiveObject(raw) {
				const listeners = new Set();
				return new Proxy(raw, {
					get(obj, key, recv) {
						if (key === listenersSym) return listeners;
						return Reflect.get(obj, key, recv);
					},
					set(obj, key, val, recv) {
						const changed = !Object.is(obj[key], val);
						const ok = Reflect.set(obj, key, val, recv);
						if (ok && changed) {
							const snap = { ...obj };
							for (const l of listeners) l(snap, key);
						}
						return ok;
					},
					deleteProperty(obj, key) {
						const had = key in obj;
						const ok = Reflect.deleteProperty(obj, key);
						if (ok && had) {
							const snap = { ...obj };
							for (const l of listeners) l(snap, key);
						}
						return ok;
					},
				});
			}

			installRouter(api, [
				[
					(t) => Boolean(t?.[listenersSym]),
					(proxy, next, _err, cleanup) => {
						const fn = (snap) => next?.(snap);
						proxy[listenersSym].add(fn);
						next?.({ ...proxy });
						return () => {
							proxy[listenersSym].delete(fn);
							cleanup?.();
						};
					},
				],
			]);

			const user = reactiveObject({ name: "Ada", role: "admin" });
			const history = [];
			const off = sub(user, (snap) => history.push(snap));

			user.name = "Ada"; // unchanged -> ignored
			user.name = "Grace";
			delete user.role;
			off();
			user.name = "Ignored";

			expect(history).toEqual([
				{ name: "Ada", role: "admin" },
				{ name: "Grace", role: "admin" },
				{ name: "Grace" },
			]);
		});

		it("22. observes a reactive Set / Map collection wrapper emitting structural diffs", () => {
			function reactiveSet(initial = []) {
				const inner = new Set(initial);
				const watchers = new Set();
				const emit = (op, item) => {
					for (const w of watchers) w({ op, item, values: [...inner] });
				};
				return {
					__rset: true,
					add(v) {
						if (!inner.has(v)) {
							inner.add(v);
							emit("add", v);
						}
					},
					delete(v) {
						if (inner.delete(v)) emit("delete", v);
					},
					clear() {
						if (inner.size) {
							inner.clear();
							emit("clear", null);
						}
					},
					watch(fn) {
						watchers.add(fn);
						return () => watchers.delete(fn);
					},
				};
			}

			installRouter(api, [
				[(t) => t?.__rset, (rset, next) => rset.watch((diff) => next?.(diff))],
			]);

			const tags = reactiveSet(["js"]);
			const diffs = [];
			const off = sub(tags, (d) => diffs.push(`${d.op}:${d.values.join(",")}`));

			tags.add("js"); // no-op
			tags.add("reactive");
			tags.delete("js");
			tags.clear();
			off();
			tags.add("after-off");

			expect(diffs).toEqual(["add:js,reactive", "delete:reactive", "clear:"]);
		});

		it("23. subscribes to a Finite State Machine actor (next on transition, error on fault, cleanup on final state)", () => {
			function createMachine(chart, initial) {
				let state = initial;
				const subs = new Set();
				return {
					__fsm: true,
					get state() {
						return state;
					},
					send(event) {
						const nextState = chart[state]?.[event];
						if (!nextState) {
							for (const s of subs) s.error?.(new Error(`Invalid ${event} in ${state}`));
							return;
						}
						state = nextState;
						const isFinal = chart[state]?.final === true;
						for (const s of [...subs]) {
							s.next?.(state);
							if (isFinal) s.complete?.();
						}
					},
					subscribe(observer) {
						subs.add(observer);
						observer.next?.(state);
						return () => subs.delete(observer);
					},
				};
			}

			// Test in liteSub where `.subscribe` is not built-in, proving api.any owns the full FSM protocol
			installRouter(liteApi, [
				[
					(t) => t?.__fsm,
					(fsm, next, error, cleanup) =>
						fsm.subscribe({
							next,
							error,
							complete: cleanup,
						}),
				],
			]);

			const orderFsm = createMachine(
				{
					idle: { SUBMIT: "processing" },
					processing: { PAY: "shipped" },
					shipped: { final: true },
				},
				"idle",
			);

			const log = [];
			liteSub(orderFsm, (s) => log.push(s), (e) => log.push(e.message), () => log.push("FINAL"));
			orderFsm.send("PAY"); // invalid in idle -> error
			orderFsm.send("SUBMIT");
			orderFsm.send("PAY"); // transitions to final -> cleanup

			expect(log).toEqual(["idle", "Invalid PAY in idle", "processing", "shipped", "FINAL"]);
		});

		it("24. watches deep dot-paths [reactiveStore, 'user.profile.theme'] and fires only on leaf change", () => {
			const getPath = (obj, path) =>
				path.split(".").reduce((acc, k) => acc?.[k], obj);

			function createDocStore(initial) {
				let doc = initial;
				const subs = new Set();
				return {
					__doc: true,
					get: () => doc,
					patch(updater) {
						doc = updater(doc);
						for (const fn of subs) fn(doc);
					},
					onChange(fn) {
						subs.add(fn);
						return () => subs.delete(fn);
					},
				};
			}

			installRouter(api, [
				[
					(t) => Array.isArray(t) && t[0]?.__doc && typeof t[1] === "string",
					([docStore, path], next) => {
						let prev = getPath(docStore.get(), path);
						next?.(prev);
						return docStore.onChange((doc) => {
							const curr = getPath(doc, path);
							if (!Object.is(prev, curr)) {
								prev = curr;
								next?.(curr);
							}
						});
					},
				],
			]);

			const doc = createDocStore({
				user: { name: "Kai", profile: { theme: "light" } },
			});
			const themes = [];
			const off = sub([doc, "user.profile.theme"], (t) => themes.push(t));

			doc.patch((d) => ({ ...d, user: { ...d.user, name: "Kethan" } })); // leaf unchanged!
			doc.patch((d) => ({
				...d,
				user: { ...d.user, profile: { theme: "dark" } },
			}));
			off();
			doc.patch((d) => ({
				...d,
				user: { ...d.user, profile: { theme: "solarized" } },
			}));

			expect(themes).toEqual(["light", "dark"]);
		});

		it("25. coalesces synchronous mutations in a Transactional / Batched Signal Store", () => {
			let depth = 0;
			const pending = new Set();

			function batch(fn) {
				depth++;
				try {
					fn();
				} finally {
					depth--;
					if (depth === 0) {
						const toRun = [...pending];
						pending.clear();
						for (const l of toRun) l();
					}
				}
			}

			function txCell(val) {
				const subs = new Set();
				return {
					__tx: true,
					read: () => val,
					write(nv) {
						if (Object.is(val, nv)) return;
						val = nv;
						for (const s of subs) {
							if (depth > 0) pending.add(s);
							else s();
						}
					},
					listen(fn) {
						subs.add(fn);
						return () => subs.delete(fn);
					},
				};
			}

			installRouter(api, [
				[
					(t) => t?.__tx,
					(cell, next) => {
						next?.(cell.read());
						return cell.listen(() => next?.(cell.read()));
					},
				],
			]);

			const count = txCell(0);
			const seen = [];
			const off = sub(count, (v) => seen.push(v));

			batch(() => {
				count.write(1);
				count.write(2);
				count.write(3);
			});
			expect(seen).toEqual([0, 3]);
			off();
		});

		it("26. drives an Undo / Redo time-travel signal unwrapping nested thunks via get()", () => {
			function historySignal(initial) {
				const stack = [initial];
				let cursor = 0;
				const subs = new Set();
				const notify = () => {
					for (const fn of subs) fn(stack[cursor]);
				};
				return {
					__hist: true,
					current: () => stack[cursor],
					push(val) {
						stack.splice(cursor + 1);
						stack.push(val);
						cursor = stack.length - 1;
						notify();
					},
					undo() {
						if (cursor > 0) {
							cursor--;
							notify();
						}
					},
					redo() {
						if (cursor < stack.length - 1) {
							cursor++;
							notify();
						}
					},
					watch(fn) {
						subs.add(fn);
						return () => subs.delete(fn);
					},
				};
			}

			installRouter(api, [
				[
					(t) => t?.__hist,
					(h, next) => {
						next?.(get(h.current()));
						return h.watch((v) => next?.(get(v)));
					},
				],
			]);

			const editor = historySignal("v1");
			const log = [];
			const off = sub(editor, (v) => log.push(v));

			editor.push(() => "v2");
			editor.push("v3");
			editor.undo();
			editor.undo();
			editor.redo();
			off();

			expect(log).toEqual(["v1", "v2", "v3", "v2", "v1", "v2"]);
		});
	});

	// =========================================================================
	// GROUP 4: Combinators, Operators & Declarative Recipes via api.any (27–35)
	// =========================================================================
	describe("4. combinators, operators & declarative subscription recipes", () => {
		it("27. builds declarative pipe(source, map, filter, take) operators wrapping ANY inner usub source", async () => {
			const pipe = (source, ...ops) => ({ __pipe: true, source, ops });
			const map = (fn) => (step) => (v, stop) => step(fn(v), stop);
			const filter = (pred) => (step) => (v, stop) => pred(v) && step(v, stop);
			const take = (limit) => {
				let count = 0;
				return (step) => (v, stop) => {
					if (count < limit) {
						count++;
						step(v, stop);
						if (count >= limit) stop();
					}
				};
			};

			installRouter(api, [
				[
					(t) => t?.__pipe,
					({ source, ops }, next, error, cleanup) => {
						let finished = false;
						let offInner;
						const stopEarly = () => {
							if (finished) return;
							finished = true;
							offInner?.();
							cleanup?.();
						};
						const sink = ops.reduceRight(
							(acc, op) => op(acc),
							(v) => next?.(v),
						);
						offInner = sub(
							source,
							(v) => !finished && sink(v, stopEarly),
							(e) => {
								if (!finished) {
									finished = true;
									error?.(e);
								}
							},
							() => {
								if (!finished) {
									finished = true;
									cleanup?.();
								}
							},
						);
						return () => {
							finished = true;
							offInner?.();
						};
					},
				],
			]);

			const { Subject } = await import("rxjs");
			const src = new Subject();
			const out = [];

			sub(
				pipe(
					src,
					map((x) => x * 10),
					filter((x) => x >= 20),
					take(2),
				),
				(v) => out.push(v),
				null,
				() => out.push("done"),
			);

			src.next(1); // 10 -> filtered out
			src.next(2); // 20 -> emitted (1/2)
			src.next(3); // 30 -> emitted (2/2) -> auto-stops & unsubscribes inner Subject!
			src.next(4); // ignored because inner Subject was unsubscribed!

			expect(src.observed).toBe(false);
			expect(out).toEqual([20, 30, "done"]);
		});

		it("28. fan-in merge([...sources]) combining Promise + RxJS Subject + AsyncGenerator into one sub()", async () => {
			const merge = (...sources) => ({ __merge: true, sources });

			installRouter(api, [
				[
					(t) => t?.__merge,
					({ sources }, next, error, cleanup) => {
						let remaining = sources.length;
						let stopped = false;
						const disposers = sources.map((s) =>
							sub(
								s,
								(v) => !stopped && next?.(v),
								(e) => {
									if (!stopped) {
										stopped = true;
										for (const d of disposers) d?.();
										error?.(e);
									}
								},
								() => {
									if (!stopped && --remaining === 0) cleanup?.();
								},
							),
						);
						return () => {
							stopped = true;
							for (const d of disposers) d?.();
						};
					},
				],
			]);

			const { Subject } = await import("rxjs");
			const subject = new Subject();
			const p = Promise.resolve("from-promise");
			async function* gen() {
				await time(5);
				yield "from-gen";
			}

			const log = [];
			sub(merge(subject, p, gen()), (v) => log.push(v), null, () => log.push("all-complete"));

			subject.next("from-rxjs");
			await time(15);
			expect(log).toEqual(["from-rxjs", "from-promise", "from-gen"]);
			subject.complete();
			expect(log).toEqual(["from-rxjs", "from-promise", "from-gen", "all-complete"]);
		});

		it("29. combineLatest([sourceA, sourceB, sourceC]) across heterogeneous reactive sources", async () => {
			const combineLatest = (...sources) => ({ __combine: true, sources });

			installRouter(api, [
				[
					(t) => t?.__combine,
					({ sources }, next, error, cleanup) => {
						const latest = new Array(sources.length);
						const hasValue = new Array(sources.length).fill(false);
						let readyCount = 0;
						let remaining = sources.length;

						const offs = sources.map((s, idx) =>
							sub(
								s,
								(v) => {
									if (!hasValue[idx]) {
										hasValue[idx] = true;
										readyCount++;
									}
									latest[idx] = v;
									if (readyCount === sources.length) next?.([...latest]);
								},
								error,
								() => {
									if (--remaining === 0) cleanup?.();
								},
							),
						);
						return () => offs.forEach((o) => o?.());
					},
				],
			]);

			const { BehaviorSubject } = await import("rxjs");
			const a$ = new BehaviorSubject("A1");
			const b$ = new BehaviorSubject(10);
			const cPromise = Promise.resolve(true);

			const snapshots = [];
			const off = sub(combineLatest(a$, b$, cPromise), (tuple) => snapshots.push(tuple));
			await tick(3);
			expect(snapshots).toEqual([["A1", 10, true]]);

			a$.next("A2");
			b$.next(20);
			expect(snapshots).toEqual([
				["A1", 10, true],
				["A2", 10, true],
				["A2", 20, true],
			]);
			off();
		});

		it("30. race([...sources]) where the fastest source wins and immediately cancels all losers", async () => {
			const race = (...sources) => ({ __race: true, sources });

			installRouter(api, [
				[
					(t) => t?.__race,
					({ sources }, next, error, cleanup) => {
						let winner = -1;
						const offs = [];
						const cancelOthers = (keepIdx) => {
							offs.forEach((o, i) => {
								if (i !== keepIdx) o?.();
							});
						};
						sources.forEach((s, idx) => {
							offs[idx] = sub(
								s,
								(v) => {
									if (winner === -1) {
										winner = idx;
										cancelOthers(idx);
									}
									if (winner === idx) next?.(v);
								},
								(e) => {
									if (winner === -1 || winner === idx) {
										cancelOthers(-1);
										error?.(e);
									}
								},
								() => {
									if (winner === idx) cleanup?.();
								},
							);
						});
						return () => cancelOthers(-1);
					},
				],
			]);

			const { Subject } = await import("rxjs");
			const loser = new Subject();
			const winner = new Promise((r) => setTimeout(() => r("fast-win"), 5));

			const out = [];
			sub(race(loser, winner), (v) => out.push(v), null, () => out.push("done"));
			expect(loser.observed).toBe(true);

			await time(15);
			expect(loser.observed).toBe(false); // automatically cancelled when winner emitted!
			expect(out).toEqual(["fast-win", "done"]);
		});

		it("31. switchMap higher-order stream: cancels stale inner subscriptions when outer emits anew", async () => {
			const switchMap = (outer, project) => ({ __switch: true, outer, project });

			installRouter(api, [
				[
					(t) => t?.__switch,
					({ outer, project }, next, error, cleanup) => {
						let offInner = null;
						let outerDone = false;
						let innerActive = false;

						const offOuter = sub(
							outer,
							(val) => {
								offInner?.();
								innerActive = true;
								offInner = sub(
									project(val),
									next,
									error,
									() => {
										innerActive = false;
										if (outerDone) cleanup?.();
									},
								);
							},
							error,
							() => {
								outerDone = true;
								if (!innerActive) cleanup?.();
							},
						);
						return () => {
							offInner?.();
							offOuter?.();
						};
					},
				],
			]);

			const { Subject } = await import("rxjs");
			const query$ = new Subject();
			const results = [];

			sub(
				switchMap(query$, (q) => new Promise((r) => setTimeout(() => r(`res:${q}`), 12))),
				(v) => results.push(v),
				null,
				() => results.push("complete"),
			);

			query$.next("r");
			await time(4);
			query$.next("re"); // cancels "r" promise!
			await time(4);
			query$.next("react"); // cancels "re" promise!
			query$.complete();

			await time(20);
			expect(results).toEqual(["res:react", "complete"]);
		});

		it("32. declarative retry({ attempts, factory }) transparently re-subscribing flaky sources", async () => {
			const retry = (attempts, factory) => ({ __retry: true, attempts, factory });

			installRouter(api, [
				[
					(t) => t?.__retry,
					({ attempts, factory }, next, error, cleanup) => {
						let left = attempts;
						let currentOff = null;
						let cancelled = false;

						const attempt = () => {
							if (cancelled) return;
							currentOff = sub(
								factory(),
								next,
								(err) => {
									if (cancelled) return;
									if (left-- > 0) attempt();
									else error?.(err);
								},
								cleanup,
							);
						};
						attempt();
						return () => {
							cancelled = true;
							currentOff?.();
						};
					},
				],
			]);

			let tries = 0;
			const flaky = retry(2, () => {
				tries++;
				return tries < 3
					? Promise.reject(new Error(`fail-${tries}`))
					: Promise.resolve("recovered!");
			});

			const log = [];
			sub(flaky, (v) => log.push(v), (e) => log.push(e.message), () => log.push("ok"));
			await time(15);
			expect(tries).toBe(3);
			expect(log).toEqual(["recovered!", "ok"]);
		});

		it("33. microtask-coalescing debounce({ source }) buffering synchronous bursts", async () => {
			const microDebounce = (source) => ({ __microDebounce: true, source });

			installRouter(api, [
				[
					(t) => t?.__microDebounce,
					({ source }, next, error, cleanup) => {
						let scheduled = false;
						let latest;
						let cancelled = false;
						const offInner = sub(
							source,
							(v) => {
								latest = v;
								if (!scheduled) {
									scheduled = true;
									queueMicrotask(() => {
										scheduled = false;
										if (!cancelled) next?.(latest);
									});
								}
							},
							error,
							() =>
								queueMicrotask(() => {
									if (!cancelled) cleanup?.();
								}),
						);
						return () => {
							cancelled = true;
							offInner?.();
						};
					},
				],
			]);

			const { Subject } = await import("rxjs");
			const rapid = new Subject();
			const out = [];
			const off = sub(microDebounce(rapid), (v) => out.push(v));

			rapid.next(1);
			rapid.next(2);
			rapid.next(3); // burst 1 -> only 3 emitted
			await tick(2);
			rapid.next(4);
			rapid.next(5); // burst 2 -> only 5 emitted
			await tick(2);
			off();

			expect(out).toEqual([3, 5]);
		});

		it("34. multicast shareReplay(factory, bufferSize) with ref-counted upstream lifecycle", () => {
			function shareReplay(factory, bufferSize = 1) {
				const subs = new Set();
				const buffer = [];
				let upstreamOff = null;
				return {
					__shared: true,
					connect(next, error, cleanup) {
						for (const item of buffer) next?.(item);
						const subEntry = { next, error, cleanup };
						subs.add(subEntry);
						if (subs.size === 1) {
							upstreamOff = sub(
								factory(),
								(v) => {
									buffer.push(v);
									if (buffer.length > bufferSize) buffer.shift();
									for (const s of subs) s.next?.(v);
								},
								(e) => {
									for (const s of subs) s.error?.(e);
								},
								() => {
									for (const s of subs) s.cleanup?.();
								},
							);
						}
						return () => {
							subs.delete(subEntry);
							if (subs.size === 0) {
								upstreamOff?.();
								upstreamOff = null;
							}
						};
					},
				};
			}

			installRouter(api, [
				[(t) => t?.__shared, (s, next, error, cleanup) => s.connect(next, error, cleanup)],
			]);

			let upstreamConnects = 0;
			let upstreamTeardowns = 0;
			let pushFn;
			const shared = shareReplay(
				() => ({
					subscribe(emit) {
						upstreamConnects++;
						pushFn = emit;
						return () => upstreamTeardowns++;
					},
				}),
				2,
			);

			const a = [];
			const b = [];
			const offA = sub(shared, (v) => a.push(v));
			expect(upstreamConnects).toBe(1);

			pushFn("m1");
			pushFn("m2");
			pushFn("m3");

			// Late subscriber immediately receives last 2 buffered values ("m2", "m3") without reconnecting!
			const offB = sub(shared, (v) => b.push(v));
			expect(upstreamConnects).toBe(1);
			expect(b).toEqual(["m2", "m3"]);

			offA();
			expect(upstreamTeardowns).toBe(0); // still 1 subscriber alive
			offB();
			expect(upstreamTeardowns).toBe(1); // refCount reached 0 -> upstream torn down!
			expect(a).toEqual(["m1", "m2", "m3"]);
		});

		it("35. turns a declarative polling config { every, poll } into an overlap-safe live stream", async () => {
			installRouter(api, [
				[
					(t) => typeof t?.every === "number" && typeof t?.poll === "function",
					({ every, poll }, next, error, cleanup) => {
						let inflight = false;
						let stopped = false;
						const run = async () => {
							if (inflight || stopped) return;
							inflight = true;
							try {
								const v = await poll();
								if (!stopped) next?.(v);
							} catch (e) {
								if (!stopped) error?.(e);
							} finally {
								inflight = false;
							}
						};
						run();
						const id = setInterval(run, every);
						return () => {
							if (!stopped) {
								stopped = true;
								clearInterval(id);
								cleanup?.();
							}
						};
					},
				],
			]);

			let seq = 0;
			const seen = [];
			const off = sub(
				{ every: 6, poll: async () => ++seq },
				(v) => seen.push(v),
				null,
				() => seen.push("stopped"),
			);

			await time(22);
			off();
			const countAtStop = seen.length;
			expect(seen[0]).toBe(1);
			expect(seen.at(-1)).toBe("stopped");
			expect(countAtStop).toBeGreaterThanOrEqual(3);
			await time(15);
			expect(seen.length).toBe(countAtStop);
		});
	});

	// =========================================================================
	// GROUP 5: Composition, Multiplexers, Deep Unwrapping & GC Safety (36–40)
	// =========================================================================
	describe("5. composition patterns, multiplexers, deep unwrapping & GC safety", () => {
		it("36. composes independent api.any middleware plugins in chain-of-responsibility order", () => {
			function composeAny(apiObj, ...plugins) {
				const prevIs = apiObj.is;
				apiObj.is = (v) => Boolean(prevIs(v) || plugins.some((p) => p.match(v)));
				apiObj.any = (target) => {
					for (const p of plugins) {
						if (p.match(target)) return p.subscribe(target);
					}
				};
			}

			const kvPlugin = {
				match: (t) => t?.kind === "kv",
				subscribe: (t) => (next) => {
					next?.(t.val);
					return noop;
				},
			};
			const counterPlugin = {
				match: (t) => t?.kind === "counter",
				subscribe: (t) => (next) => {
					next?.(t.start);
					next?.(t.start + 1);
					return noop;
				},
			};

			composeAny(api, kvPlugin, counterPlugin);

			const out = [];
			sub({ kind: "kv", val: "alpha" }, (v) => out.push(v));
			sub({ kind: "counter", start: 10 }, (v) => out.push(v));
			sub(() => "fallback-fn-effect", (v) => out.push(v)); // falls through to default api.effect!

			expect(out).toEqual(["alpha", 10, 11, "fallback-fn-effect"]);
		});

		it("37. GraphQL / JSON-RPC subscription multiplexer routing frames over one transport", () => {
			function createRpcTransport() {
				let nextSubId = 1;
				const active = new Map();
				const wireLog = [];
				return {
					wireLog,
					query(opName, vars) {
						return { __gql: true, transport: this, opName, vars };
					},
					open(opName, vars, handlers) {
						const id = String(nextSubId++);
						active.set(id, handlers);
						wireLog.push({ type: "subscribe", id, opName, vars });
						return () => {
							if (active.delete(id)) {
								wireLog.push({ type: "complete", id });
							}
						};
					},
					serverPush(frame) {
						const h = active.get(frame.id);
						if (!h) return;
						if (frame.type === "next") h.next?.(frame.payload);
						else if (frame.type === "error") {
							active.delete(frame.id);
							h.error?.(frame.payload);
						} else if (frame.type === "complete") {
							active.delete(frame.id);
							h.cleanup?.();
						}
					},
				};
			}

			installRouter(api, [
				[
					(t) => t?.__gql,
					({ transport, opName, vars }, next, error, cleanup) =>
						transport.open(opName, vars, { next, error, cleanup }),
				],
			]);

			const rpc = createRpcTransport();
			const feedA = [];
			const feedB = [];

			const offA = sub(rpc.query("OnComment", { postId: 1 }), (d) => feedA.push(d));
			sub(
				rpc.query("OnTyping", { roomId: 9 }),
				(d) => feedB.push(d),
				null,
				() => feedB.push("server-complete"),
			);

			rpc.serverPush({ id: "1", type: "next", payload: "hi!" });
			rpc.serverPush({ id: "2", type: "next", payload: "alice typing" });
			rpc.serverPush({ id: "2", type: "complete" });
			offA();
			rpc.serverPush({ id: "1", type: "next", payload: "ignored" });

			expect(feedA).toEqual(["hi!"]);
			expect(feedB).toEqual(["alice typing", "server-complete"]);
			expect(rpc.wireLog).toEqual([
				{ type: "subscribe", id: "1", opName: "OnComment", vars: { postId: 1 } },
				{ type: "subscribe", id: "2", opName: "OnTyping", vars: { roomId: 9 } },
				{ type: "complete", id: "1" },
			]);
		});

		it("38. deep recursive get() + api.any synergy: stream emitting signal -> thunk -> nested signal", () => {
			const box = (val) => ({ __box: true, val });

			installRouter(
				api,
				[
					[
						(t) => t instanceof EventEmitter,
						(ee, next) => {
							const fn = (payload) => next?.(get(payload));
							ee.on("val", fn);
							return () => ee.off("val", fn);
						},
					],
				],
				{
					isSignal: (v) => Boolean(v?.__box),
					getSignal: (v) => v.val,
				},
			);

			const bus = new EventEmitter();
			const out = [];
			const off = sub(bus, (v) => out.push(v));

			// box -> arrow fn -> box -> arrow fn -> primitive!
			bus.emit("val", box(() => box(() => "deeply-unwrapped")));
			off();

			expect(out).toEqual(["deeply-unwrapped"]);
		});

		it("39. FinalizationRegistry automatically closes GC'd api.any targets across src, lite, and tiny", async () => {
			const detachHandle = (handle, onAutoClose) => () => {
				handle.open = false;
				handle.onFrame = null;
				onAutoClose();
			};

			for (const [apiObj, subFn] of [
				[api, sub],
				[liteApi, liteSub],
				[tinyApi, tinySub],
			]) {
				let autoClosedCount = 0;
				installRouter(apiObj, [
					[
						(t) => t?.__customSocket,
						(sock, next) => {
							sock.handle.onFrame = next;
							// Isolate `unsub` from `sock` so FinalizationRegistry's heldValue does not pin `target`!
							return detachHandle(sock.handle, () => autoClosedCount++);
						},
					],
				]);

				const payloadRefs = [];
				(() => {
					for (let i = 0; i < 12; i++) {
						const ephemeralSocket = {
							__customSocket: true,
							handle: { open: true, onFrame: null },
						};
						const heavySubscriberPayload = { buf: new Uint8Array(4096), i };
						payloadRefs.push(new WeakRef(heavySubscriberPayload));
						// Intentionally drop both `ephemeralSocket` and the returned `unsub` without calling `unsub()`!
						subFn(ephemeralSocket, () => heavySubscriberPayload.i);
					}
				})();

				await gc();
				expect(autoClosedCount).toBe(12);
				const survivingPayloads = payloadRefs.filter((r) => r.deref() !== undefined).length;
				expect(survivingPayloads).toBe(0);
			}
		});

		it("40. universal protocol suite runs identically across usub (467 B), lite (353 B), and tiny (288 B)", async () => {
			async function runUniversalSuite(apiObj, subFn, getFn, isFn) {
				const isCell = (v) => Boolean(v?.__cell);
				installRouter(
					apiObj,
					[
						// 1. Custom signal cell
						[
							isCell,
							(cell, next) => {
								next?.(getFn(cell));
								cell.subs.add(next);
								return () => cell.subs.delete(next);
							},
						],
						// 2. Custom socket
						[
							(t) => t?.__sock,
							(sock, next, _e, cleanup) => {
								sock.listeners.add(next);
								return () => {
									sock.listeners.delete(next);
									cleanup?.();
								};
							},
						],
						// 3. AsyncIterable (even in tiny!)
						[
							(t) => typeof t?.[Symbol.asyncIterator] === "function",
							(iterObj, next, error, cleanup) => {
								let stop = false;
								(async () => {
									try {
										for await (const item of iterObj) {
											if (stop) return;
											next?.(getFn(item));
										}
										if (!stop) cleanup?.();
									} catch (e) {
										if (!stop) error?.(e);
									}
								})();
								return () => {
									stop = true;
								};
							},
						],
						// 4. Declarative merge([...])
						[
							(t) => t?.__all,
							({ list }, next, error, cleanup) => {
								let left = list.length;
								const offs = list.map((item) =>
									subFn(item, next, error, () => {
										if (--left === 0) cleanup?.();
									}),
								);
								return () => offs.forEach((o) => o?.());
							},
						],
					],
					{
						isSignal: isCell,
						getSignal: (c) => c.val,
					},
				);

				const cell = {
					__cell: true,
					val: 100,
					subs: new Set(),
					set(v) {
						this.val = v;
						for (const fn of this.subs) fn(v);
					},
				};
				const sock = {
					__sock: true,
					listeners: new Set(),
					push(v) {
						for (const fn of this.listeners) fn(v);
					},
				};
				async function* gen() {
					yield cell; // yields a cell -> unwrapped via getFn()!
				}

				expect(isFn(cell)).toBe(true);
				expect(isFn(sock)).toBe(true);
				expect(isFn(gen())).toBe(true);

				const events = [];
				const off = subFn(
					{ __all: true, list: [cell, sock, Promise.resolve("P"), gen()] },
					(v) => events.push(v),
				);

				sock.push("WS");
				cell.set(200);
				await time(10);
				off();
				sock.push("ignored");
				cell.set(300);

				return events;
			}

			const resSrc = await runUniversalSuite(api, sub, get, is);
			resetAllApis();
			const resLite = await runUniversalSuite(liteApi, liteSub, liteGet, liteIs);
			resetAllApis();
			const resTiny = await runUniversalSuite(tinyApi, tinySub, tinyGet, tinyIs);

			expect(resSrc).toEqual([100, "WS", 200, "P", 200]);
			expect(resLite).toEqual(resSrc);
			expect(resTiny).toEqual(resSrc);
		});
	});
});

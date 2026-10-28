export function time(ms = 10) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function tick(n = 1) {
	return new Promise((resolve) => {
		let count = 0;
		step();
		function step() {
			if (count === n) return resolve();
			count++;
			Promise.resolve().then(step);
		}
	});
}

/**
 * Deterministically flushes WeakRef [[KeptObjects]] and FinalizationRegistry callbacks
 * across multiple macrotask turns and major V8 GC passes without needing --allow-natives-syntax.
 */
export async function gc() {
	for (let i = 0; i < 4; i++) {
		await time(15);
		if (typeof globalThis.gc === "function") {
			try {
				await globalThis.gc({ execution: "async", type: "major" });
			} catch {
				globalThis.gc();
			}
		}
	}
	await time(20);
}

export function createApiResetter(...apis) {
	const snapshots = new Map(
		apis.map((apiObj) => [
			apiObj,
			{ effect: apiObj.effect, is: apiObj.is, get: apiObj.get },
		]),
	);
	return () => {
		for (const [apiObj, orig] of snapshots) {
			apiObj.effect = orig.effect;
			apiObj.is = orig.is;
			apiObj.get = orig.get;
			apiObj.cleanup = undefined;
			apiObj.any = undefined;
		}
	};
}

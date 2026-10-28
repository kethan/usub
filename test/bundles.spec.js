import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { gc, tick } from "./helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

async function ensureBundlesBuilt() {
	if (!fs.existsSync(path.join(rootDir, "dist/index.es.js"))) {
		const { rollup } = await import("rollup");
		const { default: configs } = await import("../rollup.config.js");
		for (const cfg of configs) {
			const bundle = await rollup(cfg);
			for (const out of cfg.output) await bundle.write(out);
			await bundle.close();
		}
	}
}

describe("built bundles (ESM, CJS, UMD, IIFE) & package exports", () => {
	it("verifies ESM, native CJS require(), UMD (CJS/AMD/Global), and IIFE (.min.js) across root, lite, and tiny", async () => {
		await ensureBundlesBuilt();

		const req = createRequire(import.meta.url);
		const pkgJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
		const targets = [
			{ label: "root", dir: "dist", pkgSubpath: "usub", exportKey: ".", hasSub: true, hasAsync: true },
			{ label: "lite", dir: "lite/dist", pkgSubpath: "usub/lite", exportKey: "./lite", hasSub: false, hasAsync: true },
			{ label: "tiny", dir: "tiny/dist", pkgSubpath: "usub/tiny", exportKey: "./tiny", hasSub: false, hasAsync: false },
		];

		for (const item of targets) {
			const base = path.join(rootDir, item.dir);

			// 1. ESM bundle & package.json export map verification
			const esPath = path.join(base, "index.es.js");
			expect(path.resolve(rootDir, pkgJson.exports[item.exportKey].import)).toBe(esPath);
			const esMod = await import(pathToFileURL(esPath).href);
			expect(typeof esMod.sub).toBe("function");
			expect(typeof esMod.is).toBe("function");
			expect(typeof esMod.get).toBe("function");
			expect(typeof esMod.api).toBe("object");
			expect(esMod.is({ subscribe() {} })).toBe(item.hasSub);
			expect(esMod.is({ async *[Symbol.asyncIterator]() {} })).toBe(item.hasAsync);

			// 2. Native Node.js CommonJS `require()` on package subpath AND `.cjs` file
			const cjsPkg = req(item.pkgSubpath);
			const cjsFile = req(path.join(base, "index.cjs"));
			expect(cjsPkg).toBe(cjsFile);
			expect(cjsPkg.get(() => 123)).toBe(123);
			expect(cjsPkg.is(Promise.resolve())).toBe(true);
			const cjsVals = [];
			cjsPkg.sub(Promise.resolve("cjs-ok"), (x) => cjsVals.push(x), null, () => cjsVals.push("end"));
			await tick(3);
			expect(cjsVals).toEqual(["cjs-ok", "end"]);

			// 3. IIFE minified bundle (`index.min.js`) in browser-like global context
			const minCode = fs.readFileSync(path.join(base, "index.min.js"), "utf8");
			const iifeCtx = vm.createContext({ FinalizationRegistry, Symbol, Promise });
			vm.runInContext(minCode, iifeCtx);
			expect(typeof iifeCtx.usub.sub).toBe("function");
			const iifeVals = [];
			iifeCtx.usub.sub(Promise.resolve("iife-ok"), (x) => iifeVals.push(x), null, () => iifeVals.push("end"));
			await tick(3);
			expect(iifeVals).toEqual(["iife-ok", "end"]);

			// 4. UMD bundle (`index.umd.js`) across CommonJS, AMD, and Browser Global environments
			const umdCode = fs.readFileSync(path.join(base, "index.umd.js"), "utf8");

			// UMD -> CommonJS branch
			const umdCjsExports = {};
			vm.runInNewContext(umdCode, {
				exports: umdCjsExports,
				module: { exports: umdCjsExports },
				FinalizationRegistry,
				Symbol,
				Promise,
			});
			expect(umdCjsExports.get(() => "umd-cjs")).toBe("umd-cjs");

			// UMD -> AMD branch
			let amdExports;
			const define = (deps, factory) => {
				expect(deps).toEqual(["exports"]);
				amdExports = {};
				factory(amdExports);
			};
			define.amd = true;
			vm.runInNewContext(umdCode, { define, FinalizationRegistry, Symbol, Promise });
			expect(amdExports.get(() => "umd-amd")).toBe("umd-amd");

			// UMD -> Browser globalThis branch
			const umdGlobalCtx = vm.createContext({ FinalizationRegistry, Symbol, Promise });
			umdGlobalCtx.globalThis = umdGlobalCtx;
			vm.runInContext(umdCode, umdGlobalCtx);
			expect(umdGlobalCtx.usub.get(() => "umd-global")).toBe("umd-global");
		}
	});

	it("preserves @__NOINLINE__ isolation in minified & re-minified ESM bundles across root, lite, and tiny", async () => {
		await ensureBundlesBuilt();
		const { Subject } = await import("rxjs");
		const { minify } = await import("terser");

		const targets = [
			{ label: "root", dir: "dist", hasSub: true, hasAsync: true },
			{ label: "lite", dir: "lite/dist", hasSub: false, hasAsync: true },
			{ label: "tiny", dir: "tiny/dist", hasSub: false, hasAsync: false },
		];

		for (const item of targets) {
			const base = path.join(rootDir, item.dir);
			const esCode = fs.readFileSync(path.join(base, "index.es.js"), "utf8");
			expect(esCode).toContain("@__NOINLINE__");

			const minCode = fs.readFileSync(path.join(base, "index.min.js"), "utf8");
			const iifeCtx = vm.createContext({ FinalizationRegistry, Symbol, Promise });
			vm.runInContext(minCode, iifeCtx);

			const reminifiedEs = (await minify(esCode, { module: true, compress: true, mangle: true })).code;
			const dataUrl = `data:text/javascript;base64,${Buffer.from(reminifiedEs).toString("base64")}`;
			const reminMod = await import(dataUrl);

			for (const [label, subFn] of [
				[`${item.dir}/index.min.js`, iifeCtx.usub.sub],
				[`terser(${item.dir}/index.es.js)`, reminMod.sub],
			]) {
				const liveSubject = item.hasSub ? new Subject() : null;
				const livePromise = Promise.resolve("cached");
				const liveIter = item.hasAsync
					? {
							async *[Symbol.asyncIterator]() {
								yield 1;
								yield 2;
							},
						}
					: null;
				const refs = [];

				if (liveSubject) {
					for (let i = 0; i < 20; i++) {
						const nextPayload = { n: i };
						const cleanPayload = { c: i };
						const dispose = subFn(liveSubject, () => nextPayload, null, () => cleanPayload);
						refs.push(new WeakRef(nextPayload), new WeakRef(cleanPayload));
						dispose();
					}
				}

				for (let i = 0; i < 20; i++) {
					const nextPayload = { n: i };
					const cleanPayload = { c: i };
					subFn(livePromise, () => nextPayload, null, () => cleanPayload);
					refs.push(new WeakRef(nextPayload), new WeakRef(cleanPayload));
				}

				if (liveIter) {
					for (let i = 0; i < 20; i++) {
						const nextPayload = { n: i };
						const cleanPayload = { c: i };
						subFn(liveIter, () => nextPayload, null, () => cleanPayload);
						refs.push(new WeakRef(nextPayload), new WeakRef(cleanPayload));
					}
				}

				await tick(4);
				await gc();
				const held = refs.filter((r) => r.deref() !== undefined).length;
				expect(held, `${label} retained ${held}/${refs.length}`).toBe(0);
				expect([liveSubject, livePromise, liveIter].length).toBe(3);
			}
		}
	});
});

import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		execArgv: ["--expose-gc"],
		include: ["test/**/*.spec.js"],
		coverage: {
			provider: "v8",
			include: ["src/index.js", "lite/index.js", "tiny/index.js"],
			reporter: ["text"],
			thresholds: {
				statements: 100,
				branches: 100,
				functions: 100,
				lines: 100,
			},
		},
	},
});

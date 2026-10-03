import fs from "node:fs/promises";

import { defineConfig } from "tsdown";

export default defineConfig({
	clean: true,
	entry: {
		userscript: "userscript.ts",
	},
	format: "esm",
	outputOptions: {},
	dts: false,
	target: false,
	platform: "browser",
	banner: await fs.readFile("./meta.txt", "utf8"),
	deps: {
		onlyBundle: false,
		neverBundle: true,
		alwaysBundle: ["zod/mini"],
	},
});

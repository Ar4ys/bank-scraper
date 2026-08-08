import fs from "node:fs/promises";
import { defineConfig } from "tsdown";

export default defineConfig({
	clean: true,
	entry: {
		userscript: "userscript/index.ts",
	},
	format: "esm",
	outputOptions: {},
	dts: false,
	target: false,
	platform: "browser",
	banner: await fs.readFile("./userscript/meta.txt", "utf8"),
	deps: {
		onlyBundle: false,
		neverBundle: true,
		alwaysBundle: ["zod/mini"],
	},
});

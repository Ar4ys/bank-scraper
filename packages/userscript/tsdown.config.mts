import fs from "node:fs/promises";

import { defineConfig } from "tsdown";

import { buildVersion, versionPlaceholder } from "./buildVersion.mts";

const outFile = "dist/userscript.js";

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
	hooks: {
		/** Sets `@version`, bumping it in `package.json` when the bundle changed */
		async "build:done"() {
			const code = await fs.readFile(outFile, "utf8");
			const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
			const { version, versionHash, changed } = buildVersion(pkg, code);

			if (changed) {
				if (process.env.CHECK_USERSCRIPT_VERSION) {
					throw new Error(
						"The userscript changed since its version was bumped: run `mise run build-userscript` and commit packages/userscript/package.json",
					);
				}

				const updated = { ...pkg, version, versionHash };
				await fs.writeFile("package.json", `${JSON.stringify(updated, null, "\t")}\n`);
				console.log(`Userscript version bumped to ${version}`);
			}

			if (!code.includes(versionPlaceholder))
				throw new Error("meta.txt has no @version placeholder");
			await fs.writeFile(outFile, code.replace(versionPlaceholder, version));
		},
	},
	deps: {
		onlyBundle: false,
		neverBundle: true,
		alwaysBundle: ["zod/mini"],
	},
});

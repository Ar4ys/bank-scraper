import { defineConfig } from "oxfmt";

export default defineConfig({
	endOfLine: "lf",
	printWidth: 100,
	tabWidth: 2,
	useTabs: true,
	sortImports: true,
	sortTailwindcss: true,
	sortPackageJson: true,
	jsdoc: true,
});

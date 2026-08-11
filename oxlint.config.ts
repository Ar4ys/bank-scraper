import { defineConfig } from "oxlint";

export default defineConfig({
	options: {
		typeAware: true,
		maxWarnings: 0,
	},
	categories: {
		correctness: "warn",
		suspicious: "warn",
	},
	env: {
		builtin: true,
	},
});

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
	rules: {
		"typescript/consistent-return": "off",
		"typescript/no-unnecessary-type-parameters": "off",
		"typescript/no-floating-promises": [
			"warn",
			{
				allowForKnownSafeCalls: [
					{
						from: "package",
						name: ["describe", "it"],
						package: "node:test",
					},
				],
			},
		],
	},
});

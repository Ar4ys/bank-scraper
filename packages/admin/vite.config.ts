import path from "node:path";

import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [tailwindcss(), svelte()],
	resolve: {
		alias: { $lib: path.resolve(import.meta.dirname, "src/lib") },
	},
	server: {
		proxy: { "/api": "http://127.0.0.1:8585" },
	},
});

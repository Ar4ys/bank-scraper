import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";

/** Loads the config in a fresh process, since it is read once on import */
const loadConfig = (env: Record<string, string>) =>
	spawnSync(
		process.execPath,
		["-e", `await import(${JSON.stringify(path.join(import.meta.dirname, "config.ts"))})`],
		{
			env: { PATH: process.env.PATH, INGEST_API_KEY: "a", LUNCHFLOW_API_KEY: "b", ...env },
			encoding: "utf8",
		},
	);

describe("config", () => {
	it("accepts Sure's URL and key together, or neither", () => {
		assert.equal(loadConfig({}).status, 0);
		assert.equal(loadConfig({ SURE_API_URL: "http://sure:3000", SURE_API_KEY: "key" }).status, 0);
	});

	it("rejects one of Sure's URL and key without the other", () => {
		const urlOnly = loadConfig({ SURE_API_URL: "http://sure:3000" });
		assert.notEqual(urlOnly.status, 0);
		assert.match(urlOnly.stderr, /Set both SURE_API_URL and SURE_API_KEY/);

		assert.notEqual(loadConfig({ SURE_API_KEY: "key" }).status, 0);
	});
});

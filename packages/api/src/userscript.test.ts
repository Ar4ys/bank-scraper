import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

import { createTestDb, testIngestApiKey } from "./db/testDb.ts";

const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "bank-scraper-userscript-"));
const scriptPath = path.join(scriptDir, "userscript.js");
process.env.USERSCRIPT_PATH = scriptPath;

const { cleanup } = await createTestDb();
const { app } = await import("./app.ts");
after(() => {
	cleanup();
	fs.rmSync(scriptDir, { recursive: true });
});

const script = [
	"// ==UserScript==",
	"// @name Transactions Fetcher - PKO Bank Polski",
	'// @var text serverUrl "Server URL" http://localhost:8585',
	'// @var text ingestApiKey "Ingest API key" changeme',
	"// @version 1.4.7",
	"// ==/UserScript==",
	"console.log(serverUrl, ingestApiKey);",
	"",
].join("\n");

type AdminUserscript = { installPath: string; version: string | null };

const adminUserscript = async () => {
	const response = await app.request("/api/admin/userscript");
	assert.equal(response.status, 200);
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	return (await response.json()) as AdminUserscript;
};

const installPath = async () => (await adminUserscript()).installPath;

describe("userscript routes", () => {
	beforeEach(() => fs.writeFileSync(scriptPath, script));

	it("tells the admin app the install path and the version", async () => {
		const userscript = await adminUserscript();

		assert.match(
			userscript.installPath,
			/^\/api\/userscript\/[0-9a-f]{32}\/bank-scraper\.user\.js$/,
		);
		assert.equal(userscript.version, "1.4.7");
	});

	it("answers the version without a key", async () => {
		const response = await app.request("/api/userscript/version");
		assert.deepEqual(await response.json(), { version: "1.4.7" });
	});

	it("serves the script with this server's URL and ingest key as defaults", async () => {
		const response = await app.request(`http://bank.lan:8585${await installPath()}`);
		const served = await response.text();

		assert.equal(response.status, 200);
		assert.match(response.headers.get("content-type") ?? "", /^text\/plain/);
		assert.equal(
			served,
			script
				.replace("http://localhost:8585", "http://bank.lan:8585")
				.replace("changeme", testIngestApiKey),
		);
	});

	it("takes the URL the reverse proxy reports", async () => {
		const response = await app.request(`http://bank-scraper:8585${await installPath()}`, {
			headers: { "X-Forwarded-Proto": "https", "X-Forwarded-Host": "bank.example.com, internal" },
		});

		assert.match(
			await response.text(),
			/^\/\/ @var text serverUrl "Server URL" https:\/\/bank\.example\.com$/m,
		);
	});

	it("answers 404 for a wrong token and while the script is not built", async () => {
		assert.equal(
			(await app.request("/api/userscript/0123456789abcdef0123456789abcdef/bank-scraper.user.js"))
				.status,
			404,
		);

		fs.rmSync(scriptPath);
		assert.equal((await app.request(await installPath())).status, 404);
		assert.equal((await app.request("/api/userscript/version")).status, 404);

		assert.equal((await adminUserscript()).version, null);
	});
});

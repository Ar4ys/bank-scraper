import { createHmac } from "node:crypto";
import fs from "node:fs/promises";

import { Hono, type Context } from "hono";

import { secretsEqual } from "./auth.ts";
import { config } from "./config.ts";

// FireMonkey offers to install a script only from a URL that ends in `.user.js`
const fileName = "bank-scraper.user.js";

/**
 * Secret part of the install URL. FireMonkey fetches updates without our key, so the route that
 * hands out the script with the key in it is guarded by this instead. It changes with the key.
 */
const installToken = () =>
	createHmac("sha256", config.INGEST_API_KEY).update("userscript").digest("hex").slice(0, 32);

/** Path to open in the browser to install the userscript with this server's URL and key filled in */
export const userscriptInstallPath = () => `/api/userscript/${installToken()}/${fileName}`;

/** The built userscript, or `undefined` when it was not built */
export async function readUserscript(): Promise<string | undefined> {
	try {
		return await fs.readFile(config.USERSCRIPT_PATH, "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
		throw error;
	}
}

export const userscriptVersion = (script: string) =>
	/^\/\/ @version\s+(\S+)/m.exec(script)?.[1] ?? null;

/**
 * Replaces the default value of a userscript's `@var`. FireMonkey takes the default only on the
 * first install; afterwards the value stored in its settings wins.
 */
function setVarDefault(script: string, name: string, value: string) {
	// The value is the rest of the metadata line
	if (/[\r\n]/.test(value)) throw new Error(`The default of @var ${name} cannot span lines`);

	const line = new RegExp(
		String.raw`^(// @var\s+\S+\s+${name}\s+(?:"[^"]*"|'[^']*'|\S+)\s+).*$`,
		"m",
	);
	if (!line.test(script)) throw new Error(`The userscript has no @var ${name}`);

	return script.replace(line, (_, start: string) => start + value);
}

/** Origin the client reached the server at, as the reverse proxy in front of it reports it */
function requestOrigin(c: Context) {
	const forwarded = (name: string) => c.req.header(name)?.split(",")[0]?.trim() || undefined;
	const url = new URL(c.req.url);

	const protocol = forwarded("x-forwarded-proto") ?? url.protocol.slice(0, -1);
	return `${protocol}://${forwarded("x-forwarded-host") ?? url.host}`;
}

/** The userscript for FireMonkey: installs, updates, and the version check of installed copies */
export const userscriptApi = new Hono()
	/** GET /api/userscript/version */
	.get("/version", async (c) => {
		const script = await readUserscript();
		if (script === undefined) return c.notFound();

		return c.json({ version: userscriptVersion(script) });
	})

	/** GET /api/userscript/:token/bank-scraper.user.js */
	.get(`/:token/${fileName}`, async (c) => {
		if (!secretsEqual(c.req.param("token"), installToken())) return c.notFound();

		const script = await readUserscript();
		if (script === undefined) return c.notFound();

		const served = setVarDefault(
			setVarDefault(script, "serverUrl", requestOrigin(c)),
			"ingestApiKey",
			config.INGEST_API_KEY,
		);

		// Shown as text, which is what FireMonkey's installer reads from the page
		return c.text(served, 200, { "Cache-Control": "no-store" });
	});

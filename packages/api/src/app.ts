import fs from "node:fs";

import {
	accountBalancesBodySchema,
	accountNumberSchema,
	ingestBodySchema,
} from "@bank-scraper/shared";
import { serveStatic } from "@hono/node-server/serve-static";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { prettyJSON } from "hono/pretty-json";
import { z } from "zod";

import { adminApi } from "./admin.ts";
import { apiKeyAuth } from "./auth.ts";
import { config } from "./config.ts";
import { getLastOrderDate, ingestAccountBalances, ingestRawTransactions } from "./ingest.ts";
import { lunchflowApi } from "./lunchflow.ts";
import { userscriptApi } from "./userscript.ts";
import { zValidatorHook } from "./utils.ts";

export const app = new Hono();

app.use(prettyJSON());
app.notFound((c) => c.json({ message: "Not Found", ok: false }, 404));

/** POST /api/transactions/raw */
app.post(
	"/api/transactions/raw",
	apiKeyAuth(config.INGEST_API_KEY),
	zValidator("json", ingestBodySchema, zValidatorHook),
	async (c) => {
		const insertedTransactions = await ingestRawTransactions(c.req.valid("json"));
		return c.json(insertedTransactions);
	},
);

/** POST /api/accounts/balances */
app.post(
	"/api/accounts/balances",
	apiKeyAuth(config.INGEST_API_KEY),
	zValidator("json", accountBalancesBodySchema, zValidatorHook),
	async (c) => c.json(await ingestAccountBalances(c.req.valid("json"))),
);

/** GET /api/accounts/:accountNumber/last-transaction-date */
app.get(
	"/api/accounts/:accountNumber/last-transaction-date",
	apiKeyAuth(config.INGEST_API_KEY),
	zValidator("param", z.object({ accountNumber: accountNumberSchema })),
	async (c) => c.json({ orderDate: await getLastOrderDate(c.req.valid("param").accountNumber) }),
);

app.route("/api/userscript", userscriptApi);
app.route("/api/lunchflow", lunchflowApi);
app.route("/api/admin", adminApi);

app.all("/api/*", (c) => c.notFound());

// The built admin app. It routes on the client, so unknown paths get its index.html.
if (fs.existsSync(config.ADMIN_APP_DIR)) {
	app.use(serveStatic({ root: config.ADMIN_APP_DIR }));
	app.get("*", serveStatic({ root: config.ADMIN_APP_DIR, path: "index.html" }));
}

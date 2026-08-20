import { serve } from "@hono/node-server";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { prettyJSON } from "hono/pretty-json";
import { z } from "zod";

import { db, initSQLite } from "./db/db.ts";
import { insertRawTransactionsBatch, rawTransactionsInputSchema } from "./transactions.ts";
import { registerShutdownHandlers, zValidatorHook } from "./utils.ts";

const app = new Hono();

app.get("/", (c) => c.text("Pretty Blog API"));
app.use(prettyJSON());
app.notFound((c) => c.json({ message: "Not Found", ok: false }, 404));

const api = new Hono();

api.get("/transactions/raw", async (c) => {
	return c.json({ data: await db.query.rawTransactions.findMany() });
});

api.get("/transactions/raw/:id", zValidator("param", z.object({ id: z.uuidv7() })), async (c) => {
	const { id } = c.req.valid("param");
	const data = await db.query.rawTransactions.findFirst({ where: { id } });
	return c.json({ data });
});

api.post(
	"/transactions/raw",
	zValidator("json", rawTransactionsInputSchema, zValidatorHook),
	async (c) => {
		const rawTransactions = c.req.valid("json");
		const insertedTransaction = await insertRawTransactionsBatch(rawTransactions);
		return c.json(insertedTransaction);
	},
);

app.route("/api", api);

async function main() {
	await initSQLite();

	const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 8585 }, (info) => {
		console.log(`Running on ${info.address}:${info.port}`);
	});

	registerShutdownHandlers(server);
}

void main();

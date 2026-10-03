import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { prettyJSON } from "hono/pretty-json";
import { z } from "zod";

import { db } from "./db/db.ts";
import { insertRawTransactionsBatch, rawTransactionsInputSchema } from "./transactions.ts";
import { zValidatorHook } from "./utils.ts";

export const app = new Hono();

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

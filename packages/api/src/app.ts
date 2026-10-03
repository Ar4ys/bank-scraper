import { ingestBodySchema } from "@bank-scraper/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { prettyJSON } from "hono/pretty-json";
import { z } from "zod";

import { apiKeyAuth } from "./auth.ts";
import { config } from "./config.ts";
import { db } from "./db/db.ts";
import { ingestRawTransactions } from "./ingest.ts";
import { zValidatorHook } from "./utils.ts";

export const app = new Hono();

app.use(prettyJSON());
app.notFound((c) => c.json({ message: "Not Found", ok: false }, 404));

const rawTransactionsApi = new Hono();

rawTransactionsApi.use(apiKeyAuth(config.INGEST_API_KEY));

rawTransactionsApi.get("/", async (c) => {
	return c.json({ data: await db.query.rawTransactions.findMany() });
});

rawTransactionsApi.get("/:id", zValidator("param", z.object({ id: z.uuidv7() })), async (c) => {
	const { id } = c.req.valid("param");
	const data = await db.query.rawTransactions.findFirst({ where: { id } });
	return c.json({ data });
});

rawTransactionsApi.post("/", zValidator("json", ingestBodySchema, zValidatorHook), async (c) => {
	const insertedTransactions = await ingestRawTransactions(c.req.valid("json"));
	return c.json(insertedTransactions);
});

app.route("/api/transactions/raw", rawTransactionsApi);

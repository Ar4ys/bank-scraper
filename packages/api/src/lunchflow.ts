import { zPlainDate, type TransactionAmount } from "@bank-scraper/shared";
import { zValidator } from "@hono/zod-validator";
import { and, eq, gte, isNotNull, lte } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { apiKeyAuth } from "./auth.ts";
import { config } from "./config.ts";
import { db, tables } from "./db/db.ts";

/** Lunch Flow sends amounts as JSON numbers in major units */
const toMajorUnits = (amount: TransactionAmount) => Number(amount) / 100;

const accountParamSchema = z.object({ id: z.coerce.number().int() });

// Sure sends start_date/end_date, the Lunch Flow docs name them from/to
const transactionsQuerySchema = z.object({
	start_date: zPlainDate.optional(),
	from: zPlainDate.optional(),
	end_date: zPlainDate.optional(),
	to: zPlainDate.optional(),
});

const badRequest = { error: "Bad Request", message: "Invalid request parameters" };
const accountNotFound = { error: "Not Found", message: "Account not found" };

const { accounts, transactions } = tables;

/**
 * The part of the Lunch Flow Personal API that Sure uses, backed by our transactions:
 * https://lunchflow.app/docs/api/personal-api-overview
 */
export const lunchflowApi = new Hono()
	.use(apiKeyAuth(config.LUNCHFLOW_API_KEY))

	/** GET /api/lunchflow/accounts */
	.get("/accounts", async (c) => {
		// An account without a currency has no processed transaction yet, so there is nothing to sync
		const rows = await db.select().from(accounts).where(isNotNull(accounts.currency));

		return c.json({
			accounts: rows.map((account) => ({
				id: account.id,
				connection_id: 1,
				name: account.name,
				institution_name: "PKO Bank Polski",
				institution_logo: "",
				provider: "ipko",
				currency: account.currency,
				status: "ACTIVE",
			})),
			total: rows.length,
		});
	})

	/** GET /api/lunchflow/accounts/:id/transactions */
	.get(
		"/accounts/:id/transactions",
		zValidator("param", accountParamSchema, (result, c) =>
			result.success ? undefined : c.json(badRequest, 400),
		),
		zValidator("query", transactionsQuerySchema, (result, c) =>
			result.success ? undefined : c.json(badRequest, 400),
		),
		async (c) => {
			const { id } = c.req.valid("param");
			const query = c.req.valid("query");
			const from = query.start_date ?? query.from;
			const to = query.end_date ?? query.to;

			const account = await db.query.accounts.findFirst({ where: { id } });
			if (!account) return c.json(accountNotFound, 404);

			const rows = await db
				.select()
				.from(transactions)
				.where(
					and(
						eq(transactions.accountId, id),
						from && gte(transactions.date, from),
						to && lte(transactions.date, to),
					),
				)
				.orderBy(transactions.date, transactions.id);

			return c.json({
				transactions: rows.map((transaction) => ({
					id: transaction.id,
					accountId: transaction.accountId,
					amount: toMajorUnits(transaction.amount),
					currency: transaction.currency,
					date: transaction.date.toString(),
					merchant: transaction.merchant ?? "",
					description: transaction.description,
					isPending: transaction.isPending,
				})),
				total: rows.length,
			});
		},
	)

	/** GET /api/lunchflow/accounts/:id/balance */
	.get(
		"/accounts/:id/balance",
		zValidator("param", accountParamSchema, (result, c) =>
			result.success ? undefined : c.json(badRequest, 400),
		),
		async (c) => {
			const { id } = c.req.valid("param");

			const account = await db.query.accounts.findFirst({ where: { id } });
			if (!account) return c.json(accountNotFound, 404);

			if (account.balanceAmount === null || account.balanceCurrency === null) {
				// Sure keeps its previous balance when this call fails, which beats a made-up zero
				return c.json(
					{ error: "Not Found", message: "No balance was scraped for this account yet" },
					404,
				);
			}

			return c.json({
				balance: {
					amount: toMajorUnits(account.balanceAmount),
					currency: account.balanceCurrency,
				},
			});
		},
	)

	/** GET /api/lunchflow/accounts/:id/holdings */
	.get("/accounts/:id/holdings", (c) =>
		// 501 is what tells Sure that the account has no holdings
		c.json({ error: "Not Implemented", message: "Holdings are not supported" }, 501),
	);

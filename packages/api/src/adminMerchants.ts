import { zValidator } from "@hono/zod-validator";
import { count, eq, isNotNull, TransactionRollbackError } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";

import { reportJson } from "./adminRules.ts";
import { db, tables } from "./db/db.ts";
import { sqlDateTimeNow, TransactionVersionCause, type Merchant } from "./db/schema.ts";
import { merchantKey } from "./processing/merchants.ts";
import { listBankTransactionKeys, processBankTransactions } from "./processing/process.ts";

const { merchants, merchantNames, transactions } = tables;

const idParam = zValidator("param", z.object({ id: z.string() }));

const dryRunQuery = zValidator(
	"query",
	z.object({
		/** Report what would change without writing anything */
		dryRun: z.stringbool().default(false),
	}),
);

type Rejection = { rejected: { status: 400 | 404 | 409; message: string } };

const reject = (status: Rejection["rejected"]["status"], message: string): Rejection => ({
	rejected: { status, message },
});

const notFound = reject(404, "Merchant not found");

const findMerchant = (id: string) => db.select().from(merchants).where(eq(merchants.id, id)).get();

/**
 * Runs a change of merchants and derives every transaction again, so that they get their new
 * merchant and a version that records it. Returns what `change` returned together with the report
 * of that processing, or the rejection of `change`, which must not have written anything then.
 *
 * With `dryRun` all of it is rolled back, and the report says what would change.
 */
function changeMerchants<T extends object>(dryRun: boolean, change: () => Rejection | T) {
	const outcome: { value?: Rejection | (T & ReturnType<typeof reportJson>) } = {};

	try {
		db.transaction((tx) => {
			const changed = change();

			if ("rejected" in changed) {
				outcome.value = changed;
				return;
			}

			const report = processBankTransactions(listBankTransactionKeys(), {
				cause: TransactionVersionCause.Merchants,
			});
			outcome.value = { ...changed, ...reportJson(report) };

			// A dry run that only pretended could report something else than the real run does
			if (dryRun) tx.rollback();
		});
	} catch (error) {
		if (!(error instanceof TransactionRollbackError)) throw error;
	}

	if (!outcome.value) throw new Error("The change of merchants has no outcome");

	return outcome.value;
}

const respond = <T extends object>(c: Context, result: Rejection | T) =>
	"rejected" in result
		? c.json({ message: result.rejected.message }, result.rejected.status)
		: c.json(result, 200);

const describeMerchant = (merchant: Merchant) =>
	`"${merchant.name}"${merchant.deletedAt ? " (deleted)" : ""}`;

/** Merchants of the admin API, mounted at /api/admin/merchants */
export const adminMerchantsApi = new Hono()
	/** GET /api/admin/merchants */
	.get("/", (c) => {
		const names = db.select().from(merchantNames).orderBy(merchantNames.name).all();

		const counts = db
			.select({ merchantId: transactions.merchantId, total: count() })
			.from(transactions)
			.where(isNotNull(transactions.merchantId))
			.groupBy(transactions.merchantId)
			.all();

		const rows = db.select().from(merchants).orderBy(merchants.name).all();

		return c.json(
			rows.map((merchant) => ({
				id: merchant.id,
				name: merchant.name,
				deletedAt: merchant.deletedAt?.toString() ?? null,
				/** Always 0 for a deleted merchant: its transactions have no merchant */
				transactionCount: counts.find((row) => row.merchantId === merchant.id)?.total ?? 0,
				/** The names that stand for the merchant besides the one it is shown with */
				otherNames: names
					.filter(
						(name) => name.merchantId === merchant.id && name.key !== merchantKey(merchant.name),
					)
					.map(({ key, name }) => ({ key, name })),
			})),
			200,
		);
	})

	/** PATCH /api/admin/merchants/:id */
	.patch(
		"/:id",
		idParam,
		dryRunQuery,
		zValidator("json", z.object({ name: z.string().trim().nonempty() })),
		(c) => {
			const { id } = c.req.valid("param");
			const { name } = c.req.valid("json");

			const result = changeMerchants(c.req.valid("query").dryRun, () => {
				const merchant = findMerchant(id);
				if (!merchant) return notFound;

				const key = merchantKey(name);
				const known = db.select().from(merchantNames).where(eq(merchantNames.key, key)).get();

				if (known && known.merchantId !== id) {
					const owner = findMerchant(known.merchantId);

					return reject(
						409,
						`"${name}" is already a name of the merchant ${owner ? describeMerchant(owner) : known.merchantId}. Merge the two merchants instead.`,
					);
				}

				// The previous name stays a name of the merchant, so whatever still derives it ends up here
				if (!known) db.insert(merchantNames).values({ key, name, merchantId: id }).run();

				db.update(merchants)
					.set({ name, updatedAt: sqlDateTimeNow })
					.where(eq(merchants.id, id))
					.run();

				return {};
			});

			return respond(c, result);
		},
	)

	/** POST /api/admin/merchants/:id/merge */
	.post(
		"/:id/merge",
		idParam,
		dryRunQuery,
		zValidator(
			"json",
			z.object({
				/** The merchant that takes over the names and transactions of this one */
				intoId: z.string(),
			}),
		),
		(c) => {
			const { id } = c.req.valid("param");
			const { intoId } = c.req.valid("json");

			if (id === intoId) return c.json({ message: "Cannot merge a merchant into itself" }, 400);

			const result = changeMerchants(c.req.valid("query").dryRun, () => {
				const merchant = findMerchant(id);
				const into = findMerchant(intoId);
				if (!merchant || !into) return notFound;

				if (merchant.deletedAt || into.deletedAt) {
					return reject(409, "Restore a deleted merchant before merging it");
				}

				db.update(merchantNames)
					.set({ merchantId: intoId })
					.where(eq(merchantNames.merchantId, id))
					.run();
				// Reprocessing renames them, but the merchant cannot be deleted while they point at it
				db.update(transactions)
					.set({ merchantId: intoId })
					.where(eq(transactions.merchantId, id))
					.run();
				db.delete(merchants).where(eq(merchants.id, id)).run();

				return {};
			});

			return respond(c, result);
		},
	)

	/** POST /api/admin/merchants/:id/detach */
	.post(
		"/:id/detach",
		idParam,
		dryRunQuery,
		zValidator(
			"json",
			z.object({
				/** `key` of the name that becomes a merchant of its own again */
				key: z.string(),
			}),
		),
		(c) => {
			const { id } = c.req.valid("param");
			const { key } = c.req.valid("json");

			const result = changeMerchants(c.req.valid("query").dryRun, () => {
				const merchant = findMerchant(id);
				if (!merchant) return notFound;

				const name = db.select().from(merchantNames).where(eq(merchantNames.key, key)).get();
				if (name?.merchantId !== id) return reject(404, "The merchant has no such name");

				if (key === merchantKey(merchant.name)) {
					return reject(400, "Cannot detach the name the merchant is shown with");
				}

				const detached = db.insert(merchants).values({ name: name.name }).returning().get();
				db.update(merchantNames)
					.set({ merchantId: detached.id })
					.where(eq(merchantNames.key, key))
					.run();

				return { merchantId: detached.id };
			});

			return respond(c, result);
		},
	)

	/** DELETE /api/admin/merchants/:id */
	.delete("/:id", idParam, dryRunQuery, (c) => {
		const { id } = c.req.valid("param");

		const result = changeMerchants(c.req.valid("query").dryRun, () => {
			const merchant = findMerchant(id);
			if (!merchant) return notFound;

			if (!merchant.deletedAt) {
				db.update(merchants)
					.set({ deletedAt: Temporal.Now.instant(), updatedAt: sqlDateTimeNow })
					.where(eq(merchants.id, id))
					.run();
			}

			return {};
		});

		return respond(c, result);
	})

	/** POST /api/admin/merchants/:id/restore */
	.post("/:id/restore", idParam, dryRunQuery, (c) => {
		const { id } = c.req.valid("param");

		const result = changeMerchants(c.req.valid("query").dryRun, () => {
			if (!findMerchant(id)) return notFound;

			db.update(merchants)
				.set({ deletedAt: null, updatedAt: sqlDateTimeNow })
				.where(eq(merchants.id, id))
				.run();

			return {};
		});

		return respond(c, result);
	});

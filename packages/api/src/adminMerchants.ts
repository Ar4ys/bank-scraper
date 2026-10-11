import { zValidator } from "@hono/zod-validator";
import { count, eq, isNotNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { db, tables } from "./db/db.ts";
import { sqlDateTimeNow, TransactionVersionCause, type Merchant } from "./db/schema.ts";
import { merchantKey } from "./processing/merchants.ts";
import { listBankTransactionKeys, processBankTransactions } from "./processing/process.ts";

const { merchants, merchantNames, transactions } = tables;

const idParam = zValidator("param", z.object({ id: z.string() }));

const notFound = { message: "Merchant not found" };

const findMerchant = (id: string) => db.select().from(merchants).where(eq(merchants.id, id)).get();

/**
 * Derives every transaction again after merchants changed, so that they get their new merchant and
 * a version that records it.
 */
function reprocess() {
	const report = processBankTransactions(listBankTransactionKeys(), {
		cause: TransactionVersionCause.Merchants,
	});

	return { changedTransactions: report.changes.length };
}

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
		zValidator("json", z.object({ name: z.string().trim().nonempty() })),
		(c) => {
			const { id } = c.req.valid("param");
			const { name } = c.req.valid("json");

			return db.transaction(() => {
				const merchant = findMerchant(id);
				if (!merchant) return c.json(notFound, 404);

				const key = merchantKey(name);
				const known = db.select().from(merchantNames).where(eq(merchantNames.key, key)).get();

				if (known && known.merchantId !== id) {
					const owner = findMerchant(known.merchantId);

					return c.json(
						{
							message: `"${name}" is already a name of the merchant ${owner ? describeMerchant(owner) : known.merchantId}. Merge the two merchants instead.`,
						},
						409,
					);
				}

				// The previous name stays a name of the merchant, so whatever still derives it ends up here
				if (!known) db.insert(merchantNames).values({ key, name, merchantId: id }).run();

				db.update(merchants)
					.set({ name, updatedAt: sqlDateTimeNow })
					.where(eq(merchants.id, id))
					.run();

				return c.json(reprocess(), 200);
			});
		},
	)

	/** POST /api/admin/merchants/:id/merge */
	.post(
		"/:id/merge",
		idParam,
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

			return db.transaction(() => {
				const merchant = findMerchant(id);
				const into = findMerchant(intoId);
				if (!merchant || !into) return c.json(notFound, 404);

				if (merchant.deletedAt || into.deletedAt) {
					return c.json({ message: "Restore a deleted merchant before merging it" }, 409);
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

				return c.json(reprocess(), 200);
			});
		},
	)

	/** POST /api/admin/merchants/:id/detach */
	.post(
		"/:id/detach",
		idParam,
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

			return db.transaction(() => {
				const merchant = findMerchant(id);
				if (!merchant) return c.json(notFound, 404);

				const name = db.select().from(merchantNames).where(eq(merchantNames.key, key)).get();
				if (name?.merchantId !== id) {
					return c.json({ message: "The merchant has no such name" }, 404);
				}

				if (key === merchantKey(merchant.name)) {
					return c.json({ message: "Cannot detach the name the merchant is shown with" }, 400);
				}

				const detached = db.insert(merchants).values({ name: name.name }).returning().get();
				db.update(merchantNames)
					.set({ merchantId: detached.id })
					.where(eq(merchantNames.key, key))
					.run();

				return c.json({ merchantId: detached.id, ...reprocess() }, 200);
			});
		},
	)

	/** DELETE /api/admin/merchants/:id */
	.delete("/:id", idParam, (c) => {
		const { id } = c.req.valid("param");

		return db.transaction(() => {
			const merchant = findMerchant(id);
			if (!merchant) return c.json(notFound, 404);

			if (!merchant.deletedAt) {
				db.update(merchants)
					.set({ deletedAt: Temporal.Now.instant(), updatedAt: sqlDateTimeNow })
					.where(eq(merchants.id, id))
					.run();
			}

			return c.json(reprocess(), 200);
		});
	})

	/** POST /api/admin/merchants/:id/restore */
	.post("/:id/restore", idParam, (c) => {
		const { id } = c.req.valid("param");

		return db.transaction(() => {
			if (!findMerchant(id)) return c.json(notFound, 404);

			db.update(merchants)
				.set({ deletedAt: null, updatedAt: sqlDateTimeNow })
				.where(eq(merchants.id, id))
				.run();

			return c.json(reprocess(), 200);
		});
	});

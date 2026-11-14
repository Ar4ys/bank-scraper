import { normalizeDomain } from "@bank-scraper/shared";
import { zValidator } from "@hono/zod-validator";
import { count, eq, isNotNull, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import {
	changeAndReprocess,
	dryRunQuery,
	idParam,
	reject,
	respond,
	type Rejection,
} from "./adminChanges.ts";
import { db, tables } from "./db/db.ts";
import { sqlDateTimeNow, TransactionVersionCause, type Merchant } from "./db/schema.ts";
import { merchantKey } from "./processing/merchants.ts";
import { findSuggestions } from "./processing/merchantSimilarity.ts";

const { merchants, merchantNames, merchantDismissals, transactions } = tables;

/** One key per unordered pair of merchant ids */
const dismissalKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

const notFound = reject(404, "Merchant not found");

const findMerchant = (id: string) => db.select().from(merchants).where(eq(merchants.id, id)).get();

/** `changeAndReprocess` of a change of merchants */
const changeMerchants = <T extends object>(dryRun: boolean, change: () => Rejection | T) =>
	changeAndReprocess(dryRun, TransactionVersionCause.Merchants, change);

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
				/** `null` while the merchant waits to be reviewed */
				reviewedAt: merchant.reviewedAt?.toString() ?? null,
				/** Id of the category in Sure its transactions get, `null` for none */
				sureCategoryId: merchant.sureCategoryId,
				/** Its website's domain (`lidl.pl`), `null` for none */
				domain: merchant.domain,
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

	/** GET /api/admin/merchants/suggestions */
	.get("/suggestions", (c) => {
		const active = db.select().from(merchants).where(isNull(merchants.deletedAt)).all();
		const activeIds = new Set(active.map((merchant) => merchant.id));

		const names = new Map<string, string[]>(
			active.map((merchant) => [merchant.id, [merchant.name]]),
		);
		for (const name of db.select().from(merchantNames).all()) {
			if (activeIds.has(name.merchantId)) names.get(name.merchantId)?.push(name.name);
		}

		const dismissed = new Set(
			db
				.select()
				.from(merchantDismissals)
				.all()
				.map((pair) => dismissalKey(pair.merchantId, pair.otherMerchantId)),
		);

		const suggestions = findSuggestions(names, (a, b) => dismissed.has(dismissalKey(a, b)));

		return c.json(
			/** By merchant id: the merchants that are probably the same one, best first */
			Object.fromEntries(suggestions),
			200,
		);
	})

	/** POST /api/admin/merchants/:id/review */
	.post("/:id/review", idParam, (c) => {
		const merchant = findMerchant(c.req.valid("param").id);
		if (!merchant) return c.json({ message: notFound.rejected.message }, 404);
		if (merchant.deletedAt) return c.json({ message: "A deleted merchant is not reviewed" }, 409);

		if (!merchant.reviewedAt) {
			db.update(merchants)
				.set({ reviewedAt: Temporal.Now.instant(), updatedAt: sqlDateTimeNow })
				.where(eq(merchants.id, merchant.id))
				.run();
		}

		return c.json({}, 200);
	})

	/**
	 * PUT /api/admin/merchants/:id/category
	 *
	 * Takes effect in Sure on its next sync. Transactions keep their category in Sure when it is
	 * cleared.
	 */
	.put(
		"/:id/category",
		idParam,
		zValidator("json", z.object({ sureCategoryId: z.string().nonempty().nullable() })),
		(c) => {
			const merchant = findMerchant(c.req.valid("param").id);
			if (!merchant) return c.json({ message: notFound.rejected.message }, 404);

			db.update(merchants)
				.set({ sureCategoryId: c.req.valid("json").sureCategoryId, updatedAt: sqlDateTimeNow })
				.where(eq(merchants.id, merchant.id))
				.run();

			return c.json({}, 200);
		},
	)

	/**
	 * PUT /api/admin/merchants/:id/domain
	 *
	 * Takes a domain or a URL, which is reduced to its domain, and answers with what was stored.
	 * Takes effect in Sure on its next sync; Sure keeps the website it has when the domain is
	 * cleared.
	 */
	.put(
		"/:id/domain",
		idParam,
		zValidator("json", z.object({ domain: z.string().nullable() })),
		(c) => {
			const merchant = findMerchant(c.req.valid("param").id);
			if (!merchant) return c.json({ message: notFound.rejected.message }, 404);

			const input = c.req.valid("json").domain;
			const domain = input === null || input.trim() === "" ? null : normalizeDomain(input);
			if (domain === undefined) {
				return c.json({ message: `"${input}" is not a domain such as lidl.pl` }, 400);
			}

			db.update(merchants)
				.set({ domain, updatedAt: sqlDateTimeNow })
				.where(eq(merchants.id, merchant.id))
				.run();

			return c.json({ domain }, 200);
		},
	)

	/** POST /api/admin/merchants/:id/dismiss */
	.post(
		"/:id/dismiss",
		idParam,
		zValidator(
			"json",
			z.object({
				/** The merchant that is not a duplicate of this one */
				otherId: z.string(),
			}),
		),
		(c) => {
			const { id } = c.req.valid("param");
			const { otherId } = c.req.valid("json");

			if (id === otherId) return c.json({ message: "A merchant is no duplicate of itself" }, 400);
			if (!findMerchant(id) || !findMerchant(otherId)) {
				return c.json({ message: notFound.rejected.message }, 404);
			}

			const [merchantId, otherMerchantId] = id < otherId ? [id, otherId] : [otherId, id];
			db.insert(merchantDismissals)
				.values({ merchantId, otherMerchantId })
				.onConflictDoNothing()
				.run();

			return c.json({}, 200);
		},
	)

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
					.set({ name, reviewedAt: Temporal.Now.instant(), updatedAt: sqlDateTimeNow })
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
				db.update(merchants)
					.set({
						reviewedAt: Temporal.Now.instant(),
						sureCategoryId: into.sureCategoryId ?? merchant.sureCategoryId,
						domain: into.domain ?? merchant.domain,
						updatedAt: sqlDateTimeNow,
					})
					.where(eq(merchants.id, intoId))
					.run();

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

	/** DELETE /api/admin/merchants/:id/permanent */
	.delete("/:id/permanent", idParam, dryRunQuery, (c) => {
		const { id } = c.req.valid("param");

		const result = changeMerchants(c.req.valid("query").dryRun, () => {
			const merchant = findMerchant(id);
			if (!merchant) return notFound;

			if (!merchant.deletedAt) {
				return reject(409, "Delete the merchant before removing it permanently");
			}

			// Its names are forgotten too, so a transaction that still derives one gets a new merchant
			db.delete(merchantNames).where(eq(merchantNames.merchantId, id)).run();
			db.update(transactions)
				.set({ merchantId: null })
				.where(eq(transactions.merchantId, id))
				.run();
			db.delete(merchants).where(eq(merchants.id, id)).run();

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

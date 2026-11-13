import { mapFieldSource } from "@bank-scraper/shared";
import { zValidator } from "@hono/zod-validator";
import { and, eq, isNotNull, ne } from "drizzle-orm";
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
import {
	MerchantMapField,
	sqlDateTimeNow,
	TransactionVersionCause,
	type MerchantMapEntry,
} from "./db/schema.ts";
import { matchText } from "./processing/merchantMap.ts";
import { listRecurringPlaces } from "./processing/places.ts";

const { merchantMapEntries, transactions, ignoredPlaces } = tables;

const entryInputSchema = z.object({
	field: z.enum(MerchantMapField),
	text: z.string().trim().nonempty(),
	merchant: z.string().trim().nonempty(),
});

const notFound = reject(404, "Merchant map entry not found");

const findEntry = (id: string) =>
	db.select().from(merchantMapEntries).where(eq(merchantMapEntries.id, id)).get();

/** The rejection for an entry that would have the field and text of another one */
function rejectDuplicate(field: MerchantMapField, matchKey: string, exceptId?: string) {
	const other = db
		.select()
		.from(merchantMapEntries)
		.where(
			and(
				eq(merchantMapEntries.field, field),
				eq(merchantMapEntries.matchKey, matchKey),
				exceptId === undefined ? undefined : ne(merchantMapEntries.id, exceptId),
			),
		)
		.get();

	return (
		other &&
		reject(409, `The entry "${other.text}" → ${other.merchant} already matches this ${field} text`)
	);
}

/** `changeAndReprocess` of a change of the merchant map */
const changeMap = <T extends object>(dryRun: boolean, change: () => Rejection | T) =>
	changeAndReprocess(dryRun, TransactionVersionCause.MerchantMap, change);

/** How many transactions each entry sets the merchant of now */
function countTransactionsByEntry(entries: readonly MerchantMapEntry[]) {
	const sources = db
		.select({ fieldSources: transactions.fieldSources })
		.from(transactions)
		.where(isNotNull(transactions.fieldSources))
		.all();

	const counts = new Map(entries.map((entry) => [mapFieldSource(entry.id), 0]));
	for (const { fieldSources } of sources) {
		const source = fieldSources?.merchant;
		const current = source === undefined ? undefined : counts.get(source);
		if (source !== undefined && current !== undefined) counts.set(source, current + 1);
	}

	return (entry: MerchantMapEntry) => counts.get(mapFieldSource(entry.id)) ?? 0;
}

/** The merchant map of the admin API, mounted at /api/admin/merchant-map */
export const adminMerchantMapApi = new Hono()
	/** GET /api/admin/merchant-map */
	.get("/", (c) => {
		const entries = db
			.select()
			.from(merchantMapEntries)
			.orderBy(merchantMapEntries.merchant, merchantMapEntries.text)
			.all();
		const transactionCount = countTransactionsByEntry(entries);

		return c.json(
			entries.map((entry) => ({
				id: entry.id,
				field: entry.field,
				text: entry.text,
				merchant: entry.merchant,
				/** Transactions whose merchant this entry sets now */
				transactionCount: transactionCount(entry),
			})),
			200,
		);
	})

	/** GET /api/admin/merchant-map/places */
	.get("/places", (c) => c.json(listRecurringPlaces(), 200))

	/** POST /api/admin/merchant-map/places/ignore */
	.post(
		"/places/ignore",
		zValidator(
			"json",
			z.object({
				key: z.string().nonempty(),
				/** Also when it gets new payments; otherwise until a payment dated after today */
				forever: z.boolean(),
			}),
		),
		(c) => {
			const { key, forever } = c.req.valid("json");

			// The server's today can be before the date of the place's newest payment (its clock runs on
			// another time zone than the bank's dates), which would bring the place back at once
			const today = Temporal.Now.plainDateISO();
			const lastDate = listRecurringPlaces().find((place) => place.key === key)?.lastDate;
			const ignoredOn =
				lastDate && Temporal.PlainDate.compare(Temporal.PlainDate.from(lastDate), today) > 0
					? Temporal.PlainDate.from(lastDate)
					: today;

			db.insert(ignoredPlaces)
				.values({ key, forever, ignoredOn })
				.onConflictDoUpdate({ target: ignoredPlaces.key, set: { forever, ignoredOn } })
				.run();

			return c.json({}, 200);
		},
	)

	/** POST /api/admin/merchant-map/places/restore */
	.post("/places/restore", zValidator("json", z.object({ key: z.string().nonempty() })), (c) => {
		db.delete(ignoredPlaces)
			.where(eq(ignoredPlaces.key, c.req.valid("json").key))
			.run();

		return c.json({}, 200);
	})

	/** POST /api/admin/merchant-map */
	.post("/", dryRunQuery, zValidator("json", entryInputSchema), (c) => {
		const { field, text, merchant } = c.req.valid("json");

		const result = changeMap(c.req.valid("query").dryRun, () => {
			const matchKey = matchText(text);
			const duplicate = rejectDuplicate(field, matchKey);
			if (duplicate) return duplicate;

			const entry = db
				.insert(merchantMapEntries)
				.values({ field, text, matchKey, merchant })
				.returning({ id: merchantMapEntries.id })
				.get();

			return { entryId: entry.id };
		});

		return respond(c, result);
	})

	/** PATCH /api/admin/merchant-map/:id */
	.patch("/:id", idParam, dryRunQuery, zValidator("json", entryInputSchema.partial()), (c) => {
		const { id } = c.req.valid("param");
		const input = c.req.valid("json");

		const result = changeMap(c.req.valid("query").dryRun, () => {
			const entry = findEntry(id);
			if (!entry) return notFound;

			const field = input.field ?? entry.field;
			const text = input.text ?? entry.text;
			const matchKey = matchText(text);

			const duplicate = rejectDuplicate(field, matchKey, id);
			if (duplicate) return duplicate;

			db.update(merchantMapEntries)
				.set({
					field,
					text,
					matchKey,
					merchant: input.merchant ?? entry.merchant,
					updatedAt: sqlDateTimeNow,
				})
				.where(eq(merchantMapEntries.id, id))
				.run();

			return {};
		});

		return respond(c, result);
	})

	/** DELETE /api/admin/merchant-map/:id */
	.delete("/:id", idParam, dryRunQuery, (c) => {
		const { id } = c.req.valid("param");

		const result = changeMap(c.req.valid("query").dryRun, () => {
			if (!findEntry(id)) return notFound;

			db.delete(merchantMapEntries).where(eq(merchantMapEntries.id, id)).run();
			return {};
		});

		return respond(c, result);
	});

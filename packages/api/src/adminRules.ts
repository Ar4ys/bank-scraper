import { isDeepStrictEqual } from "node:util";

import { ruleSchema, type Rule } from "@bank-scraper/shared";
import { zValidator } from "@hono/zod-validator";
import { desc, eq, TransactionRollbackError } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { dryRunQuery, reportJson } from "./adminChanges.ts";
import { db, tables } from "./db/db.ts";
import { ipkoFieldsByType, IpkoTxType } from "./ipkoSchemas.ts";
import { matchText } from "./processing/merchantMap.ts";
import { loadMerchantDirectory } from "./processing/merchants.ts";
import {
	getLatestRuleRevision,
	listBankTransactionKeys,
	loadMerchantMap,
	processBankTransactions,
	type ProcessingReport,
} from "./processing/process.ts";
import { planRuleMigration } from "./processing/ruleMigration.ts";

const { rules, ruleRevisions, merchantMapEntries } = tables;

const ipkoTxTypes = Object.values(IpkoTxType);

const isValidRegex = (pattern: string) => {
	try {
		return RegExp(pattern, "i") instanceof RegExp;
	} catch {
		return false;
	}
};

/** A rule as the editor sends it: its priority is its position in the list */
const ruleInputSchema = ruleSchema.omit({ priority: true }).extend({
	/** Left out for a rule that is new */
	id: z.string().nonempty().optional(),
	name: z.string().trim().nonempty(),
	txTypes: z.array(z.enum(ipkoTxTypes)).nonempty().nullable(),
	conditions: z.array(
		ruleSchema.shape.conditions.element.refine(
			(condition) => condition.operator !== "regex" || isValidRegex(condition.pattern),
			{ error: "Invalid regular expression", path: ["pattern"] },
		),
	),
});

const rulesInputSchema = z.object({ rules: z.array(ruleInputSchema) });

const toRules = (input: z.infer<typeof rulesInputSchema>["rules"]): Rule[] =>
	input.map((rule, index) => ({ ...rule, id: rule.id ?? crypto.randomUUID(), priority: index }));

function getWorkingRules(): Rule[] {
	return db
		.select()
		.from(rules)
		.orderBy(rules.priority)
		.all()
		.map(({ id, name, priority, enabled, txTypes, conditions, set }) => ({
			id,
			name,
			priority,
			enabled,
			txTypes,
			conditions,
			set,
		}));
}

/**
 * The revision id a dry run pretends to have, so that changes caused by rules that are not applied
 * yet are reported as caused by rules.
 */
const draftRevisionId = "draft";

/** Rules of the admin API, mounted at /api/admin/rules */
export const adminRulesApi = new Hono()
	/** GET /api/admin/rules */
	.get("/", (c) => {
		const working = getWorkingRules();
		const applied = getLatestRuleRevision();

		return c.json(
			{
				/** The rules as they are being edited, in priority order */
				rules: working,
				appliedRevisionId: applied.id,
				hasUnappliedChanges: !isDeepStrictEqual(working, applied.rules),
				txTypes: ipkoTxTypes,
				/** The fields of a parsed bank transaction that rules can read, by transaction type */
				fieldsByTxType: ipkoFieldsByType,
			},
			200,
		);
	})

	/** PUT /api/admin/rules */
	.put("/", zValidator("json", rulesInputSchema), (c) => {
		const working = toRules(c.req.valid("json").rules);

		db.transaction(() => {
			db.delete(rules).run();
			if (working.length) db.insert(rules).values(working).run();
		});

		return c.json({ rules: working }, 200);
	})

	/** POST /api/admin/rules/preview */
	.post(
		"/preview",
		zValidator(
			"json",
			rulesInputSchema.extend({
				/** Limits the preview to one bank transaction */
				only: z.object({ accountId: z.number().int(), bankId: z.string() }).optional(),
			}),
		),
		(c) => {
			const { rules: input, only } = c.req.valid("json");

			const report = processBankTransactions(only ? [only] : listBankTransactionKeys(), {
				dryRun: true,
				ruleRevision: { id: draftRevisionId, rules: toRules(input) },
			});

			return c.json(reportJson(report), 200);
		},
	)

	/** POST /api/admin/rules/apply */
	.post("/apply", (c) => {
		const working = getWorkingRules();
		const keys = listBankTransactionKeys();

		const preview = processBankTransactions(keys, {
			dryRun: true,
			ruleRevision: { id: draftRevisionId, rules: working },
		});
		const ruleErrors = preview.errors.filter(({ error }) => error.stage === "rules");

		if (ruleErrors.length) {
			return c.json(
				{
					message: `The rules produce invalid values for ${ruleErrors.length} transaction(s)`,
					errors: reportJson({ ...preview, errors: ruleErrors }).errors,
				},
				400,
			);
		}

		const revision = db.insert(ruleRevisions).values({ rules: working }).returning().get();
		const report = processBankTransactions(keys, {
			ruleRevision: { id: revision.id, rules: working },
		});

		return c.json({ revisionId: revision.id, ...reportJson(report) }, 200);
	})

	/**
	 * POST /api/admin/rules/move-to-merchant-map
	 *
	 * Replaces the rules that only map an address or city text to a merchant with merchant map
	 * entries, applies the remaining rules as a new revision and reprocesses everything. A one-off
	 * for moving existing rules to the map.
	 */
	.post("/move-to-merchant-map", dryRunQuery, (c) => {
		const working = getWorkingRules();

		if (!isDeepStrictEqual(working, getLatestRuleRevision().rules)) {
			return c.json({ message: "Apply or discard your rule edits first" }, 409);
		}

		const plan = planRuleMigration(working, loadMerchantDirectory(), loadMerchantMap());

		if (plan.conflicts.length) {
			const lines = plan.conflicts.map(
				(conflict) =>
					`- ${conflict.field} "${conflict.text}": ${conflict.merchants.map((name) => `"${name}"`).join(", ")}`,
			);
			return c.json(
				{
					message: `These texts would name different merchants. Merge the merchants or change the rules first:\n${lines.join("\n")}`,
				},
				409,
			);
		}

		const converted = new Set(plan.convertedRuleIds);
		const remaining = working
			.filter((rule) => !converted.has(rule.id))
			.map((rule, index) => ({ ...rule, priority: index }));

		const outcome: { report?: ProcessingReport } = {};

		try {
			db.transaction((tx) => {
				for (const entry of plan.entries) {
					db.insert(merchantMapEntries)
						.values({
							field: entry.field,
							text: entry.text,
							matchKey: matchText(entry.text),
							merchant: entry.merchant,
						})
						.run();
				}

				db.delete(rules).run();
				if (remaining.length) db.insert(rules).values(remaining).run();

				const revision = db.insert(ruleRevisions).values({ rules: remaining }).returning().get();
				outcome.report = processBankTransactions(listBankTransactionKeys(), {
					ruleRevision: { id: revision.id, rules: remaining },
				});

				if (c.req.valid("query").dryRun) tx.rollback();
			});
		} catch (error) {
			if (!(error instanceof TransactionRollbackError)) throw error;
		}

		if (!outcome.report) throw new Error("Moving the rules to the merchant map has no outcome");

		return c.json(
			{
				...reportJson(outcome.report),
				/** How many entries the map gets */
				entryCount: plan.entries.length,
				/** Names of the rules the entries replace */
				convertedRules: working.filter((rule) => converted.has(rule.id)).map((rule) => rule.name),
				/** Rules that stay, and why */
				keptRules: plan.keptRules.map(({ name, reason }) => ({ name, reason })),
			},
			200,
		);
	})

	/** GET /api/admin/rules/revisions */
	.get("/revisions", (c) => {
		const revisions = db.select().from(ruleRevisions).orderBy(desc(ruleRevisions.id)).all();

		return c.json(
			revisions.map((revision) => ({
				id: revision.id,
				ruleCount: revision.rules.length,
				createdAt: revision.createdAt.toString(),
			})),
			200,
		);
	})

	/** GET /api/admin/rules/revisions/:id */
	.get("/revisions/:id", (c) => {
		const revision = db
			.select()
			.from(ruleRevisions)
			.where(eq(ruleRevisions.id, c.req.param("id")))
			.get();

		if (!revision) return c.json({ message: "Rule revision not found" }, 404);

		return c.json(
			{ id: revision.id, rules: revision.rules, createdAt: revision.createdAt.toString() },
			200,
		);
	});

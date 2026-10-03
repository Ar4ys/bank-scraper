import { isDeepStrictEqual } from "node:util";

import { ruleSchema, type Rule } from "@bank-scraper/shared";
import { zValidator } from "@hono/zod-validator";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { db, tables } from "./db/db.ts";
import { IpkoTxType } from "./ipkoSchemas.ts";
import {
	getLatestRuleRevision,
	listBankTransactionKeys,
	processBankTransactions,
	type ProcessingReport,
} from "./processing/process.ts";

const { rules, ruleRevisions } = tables;

const ipkoTxTypes = Object.values(IpkoTxType);

const isValidRegex = (pattern: string) => {
	try {
		return RegExp(pattern) instanceof RegExp;
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

const reportJson = (report: ProcessingReport) => ({
	...report,
	errors: report.errors.map(({ error, ...rest }) => ({
		...rest,
		error: { stage: error.stage, message: error.message },
	})),
});

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

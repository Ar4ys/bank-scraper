import { z } from "zod";

import { getTextByPath } from "./template.ts";
import { transactionFieldsSchema, type TransactionField } from "./transaction.ts";

/** What a field was set by when no rule set it, in place of a rule id */
export const defaultFieldSource = "default";

export type RuleOperator = (typeof ruleOperators)[number];
export const ruleOperators = ["contains", "equals", "regex"] as const;

export const ruleConditionSchema = z.object({
	/** Dot path into the JSON form of the parsed bank transaction, e.g. `details.title` */
	path: z.string().nonempty(),
	operator: z.enum(ruleOperators),
	pattern: z.string(),
});
export type RuleCondition = z.infer<typeof ruleConditionSchema>;

// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const transactionFields = Object.keys(transactionFieldsSchema.shape) as TransactionField[];

/** Templates by the internal field they set, see `renderTemplate` */
export const ruleSetSchema = z.partialRecord(z.enum(transactionFields), z.string());
export type RuleSet = z.infer<typeof ruleSetSchema>;

export const ruleSchema = z.object({
	id: z.string(),
	name: z.string(),
	/** Lower runs first */
	priority: z.number().int(),
	enabled: z.boolean(),
	/** Types of bank transactions the rule applies to, `null` for all of them */
	txTypes: z.array(z.string()).nullable(),
	/** All of them have to match */
	conditions: z.array(ruleConditionSchema),
	set: ruleSetSchema,
});
export type Rule = z.infer<typeof ruleSchema>;

/**
 * Checks a rule against the JSON of a bank transaction. Returns `undefined` when the rule does not
 * apply, otherwise the capture groups for `{match.N}`, which come from the first `regex` condition
 * of the rule.
 *
 * Every operator ignores case. A path that points at nothing never matches.
 */
export function matchRule(
	rule: Pick<Rule, "txTypes" | "conditions">,
	bankTransaction: unknown,
): string[] | undefined {
	const txType = getTextByPath(bankTransaction, "$type");
	if (rule.txTypes && (txType === undefined || !rule.txTypes.includes(txType))) return undefined;

	let captures: string[] | undefined;

	for (const condition of rule.conditions) {
		const text = getTextByPath(bankTransaction, condition.path);
		if (text === undefined) return undefined;

		switch (condition.operator) {
			case "contains":
				if (!text.toLowerCase().includes(condition.pattern.toLowerCase())) return undefined;
				break;

			case "equals":
				if (text.toLowerCase() !== condition.pattern.toLowerCase()) return undefined;
				break;

			case "regex": {
				const match = new RegExp(condition.pattern, "i").exec(text);
				if (!match) return undefined;
				captures ??= [...match];
				break;
			}
		}
	}

	return captures ?? [];
}

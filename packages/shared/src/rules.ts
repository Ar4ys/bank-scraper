import { z } from "zod";

import { transactionFieldsSchema, type TransactionField } from "./transaction.ts";

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

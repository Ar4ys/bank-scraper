import {
	matchRule,
	renderTemplate,
	transactionFieldsSchema,
	type Rule,
	type TransactionField,
	type TransactionFields,
	type TransactionFieldsJson,
} from "@bank-scraper/shared";
import { z } from "zod";

import { type FieldSources } from "../db/schema.ts";

export const defaultFieldSource = "default";

/** Turns the text a template rendered into the JSON value of the field */
function fieldValueFromText(field: TransactionField, text: string) {
	switch (field) {
		case "merchant":
			return text.trim() || null;

		case "isPending":
			// Anything else is left as text, so that the schema rejects it
			return text === "true" ? true : text === "false" ? false : text;

		case "date":
		case "amount":
		case "currency":
		case "description":
			return text.trim();
	}
}

export type ApplyRulesResult =
	| { success: true; fields: TransactionFieldsJson; fieldSources: FieldSources }
	| { success: false; error: z.core.$ZodError; fieldSources: FieldSources };

/**
 * Lets rules override the default fields. For every field the first enabled rule, by priority, that
 * matches the bank transaction and sets that field wins. Fails when a rule produced a value its
 * field cannot hold, e.g. a date that is not a date.
 */
export function applyRules(
	defaults: TransactionFields,
	bankTransaction: unknown,
	rules: readonly Rule[],
): ApplyRulesResult {
	const fields: Record<string, unknown> = z.encode(transactionFieldsSchema, defaults);
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	const fieldSources = Object.fromEntries(
		Object.keys(fields).map((field) => [field, defaultFieldSource]),
	) as FieldSources;

	const matchingRules = rules
		.filter((rule) => rule.enabled)
		.toSorted((a, b) => a.priority - b.priority)
		.flatMap((rule) => {
			const captures = matchRule(rule, bankTransaction);
			return captures ? [{ rule, captures }] : [];
		});

	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	for (const field of Object.keys(fieldSources) as TransactionField[]) {
		const winner = matchingRules.find(({ rule }) => rule.set[field] !== undefined);
		if (!winner) continue;

		const text = renderTemplate(winner.rule.set[field] ?? "", bankTransaction, winner.captures);
		fields[field] = fieldValueFromText(field, text);
		fieldSources[field] = winner.rule.id;
	}

	// Decoding is what validates the values, the JSON form is what gets stored
	const result = transactionFieldsSchema.safeDecode(
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion
		fields as TransactionFieldsJson,
	);

	return result.success
		? // oxlint-disable-next-line typescript/no-unsafe-type-assertion
			{ success: true, fields: fields as TransactionFieldsJson, fieldSources }
		: { success: false, error: result.error, fieldSources };
}

import { type Rule, type TransactionFieldsJson } from "@bank-scraper/shared";
import { type z } from "zod";

import { RawTransactionStatus, type FieldSources, type ProcessingError } from "../db/schema.ts";
import { baseTxSchema, ipkoTransactionSchema } from "../ipkoSchemas.ts";
import { zodPrettifyError } from "../zod.ts";
import { deriveDefaults } from "./defaults.ts";
import { applyRules } from "./rules.ts";

export type DeriveResult =
	| { status: typeof RawTransactionStatus.Hold }
	| { status: typeof RawTransactionStatus.Error; error: ProcessingError }
	| {
			status: typeof RawTransactionStatus.Processed;
			fields: TransactionFieldsJson;
			fieldSources: FieldSources;
	  };

const schemaError = (error: z.core.$ZodError): DeriveResult => ({
	status: RawTransactionStatus.Error,
	error: { stage: "schema", message: zodPrettifyError(error), issues: error.issues },
});

/**
 * Derives the fields of a transaction from the bank's JSON: strict parsing, code defaults, then
 * rules. Rules see the bank's JSON as it was scraped, plus the `$type` the parsing assigned.
 */
export function deriveTransaction(rawData: unknown, rules: readonly Rule[]): DeriveResult {
	const base = baseTxSchema.safeParse(rawData);
	if (!base.success) return schemaError(base.error);
	if (base.data.is_hold) return { status: RawTransactionStatus.Hold };

	const parsed = ipkoTransactionSchema.safeParse(rawData);
	if (!parsed.success) return schemaError(parsed.error);

	const bankTransaction: unknown = Object.assign({}, rawData, { $type: parsed.data.$type });
	const result = applyRules(deriveDefaults(parsed.data), bankTransaction, rules);

	if (!result.success) {
		return {
			status: RawTransactionStatus.Error,
			error: {
				stage: "rules",
				message: zodPrettifyError(result.error),
				issues: result.error.issues,
			},
		};
	}

	return {
		status: RawTransactionStatus.Processed,
		fields: result.fields,
		fieldSources: result.fieldSources,
	};
}

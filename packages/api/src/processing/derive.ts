import {
	transactionFieldsSchema,
	type Rule,
	type TransactionFieldsJson,
} from "@bank-scraper/shared";
import { z } from "zod";

import { RawTransactionStatus, type FieldSources, type ProcessingError } from "../db/schema.ts";
import { baseTxSchema, ipkoTransactionSchema, ipkoTransactionToJson } from "../ipkoSchemas.ts";
import { zodPrettifyError } from "../zod.ts";
import { deriveDefaults } from "./defaults.ts";
import { applyRules } from "./rules.ts";

export type DeriveResult =
	| { status: typeof RawTransactionStatus.Hold }
	| {
			status: typeof RawTransactionStatus.Error;
			error: ProcessingError;
			/** What the transaction is, for an error of the rules: its type and the fields without rules */
			context?: { txType: string; fields: TransactionFieldsJson };
	  }
	| {
			status: typeof RawTransactionStatus.Processed;
			txType: string;
			fields: TransactionFieldsJson;
			fieldSources: FieldSources;
	  };

const schemaError = (error: z.core.$ZodError): DeriveResult => ({
	status: RawTransactionStatus.Error,
	error: { stage: "schema", message: zodPrettifyError(error), issues: error.issues },
});

/**
 * The transaction as rules see it, see `ipkoTransactionToJson`. `undefined` for a hold and for data
 * the schemas reject.
 */
export function parseForRules(rawData: unknown): Record<string, unknown> | undefined {
	const parsed = ipkoTransactionSchema.safeParse(rawData);
	return parsed.success ? ipkoTransactionToJson(parsed.data) : undefined;
}

/**
 * Derives the fields of a transaction from the bank's JSON: strict parsing, code defaults, then
 * rules. Rules see the parsed transaction in its JSON form, see `ipkoTransactionToJson`.
 */
export function deriveTransaction(rawData: unknown, rules: readonly Rule[]): DeriveResult {
	const base = baseTxSchema.safeParse(rawData);
	if (!base.success) return schemaError(base.error);
	if (base.data.is_hold) return { status: RawTransactionStatus.Hold };

	const parsed = ipkoTransactionSchema.safeParse(rawData);
	if (!parsed.success) return schemaError(parsed.error);

	const defaults = deriveDefaults(parsed.data);
	const result = applyRules(defaults, ipkoTransactionToJson(parsed.data), rules);

	if (!result.success) {
		return {
			status: RawTransactionStatus.Error,
			error: {
				stage: "rules",
				message: zodPrettifyError(result.error),
				issues: result.error.issues,
			},
			context: {
				txType: parsed.data.$type,
				fields: z.encode(transactionFieldsSchema, defaults),
			},
		};
	}

	return {
		status: RawTransactionStatus.Processed,
		txType: parsed.data.$type,
		fields: result.fields,
		fieldSources: result.fieldSources,
	};
}

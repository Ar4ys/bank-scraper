import fs from "node:fs";
import path from "node:path";

type JsonValue = string | number | boolean | null | JsonValue[] | Json;
type Json = { [key: string]: JsonValue };

const fixturesFile: { transactions: Record<string, Json> } = JSON.parse(
	fs.readFileSync(path.join(import.meta.dirname, "../fixtures/ipkoTransactions.json"), "utf8"),
);

/**
 * Every bank transaction the tests use, as iPKO sends them. They all live in one file, which also
 * says where they come from and what was changed in them: ../fixtures/ipkoTransactions.json
 */
export const ipkoExamples = fixturesFile.transactions;

const isObject = (value: JsonValue | undefined): value is Json =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const merge = (base: Json, overrides: Json): Json => {
	const result = { ...base };

	for (const [key, value] of Object.entries(overrides)) {
		const current = result[key];
		result[key] = isObject(value) && isObject(current) ? merge(current, value) : value;
	}

	return result;
};

/** One of the examples, optionally with some of its fields replaced */
export function ipkoExample(name: string, overrides: Json = {}): Json {
	const example = ipkoExamples[name];
	if (!example) throw new Error(`No example "${name}" in ipkoTransactions.json`);

	return merge(example, overrides);
}

/** A card payment for which the bank names no merchant: `LIDL 3011` in Wroclaw, bank id 19 */
export const rawCardTransaction = (overrides: Json = {}) =>
	ipkoExample("CARD_TRANSACTION/default", overrides);

/** An outgoing transfer, bank id 76 */
export const rawTransferSend = (overrides: Json = {}) =>
	ipkoExample("TRANSFER_NORMAL/iban_transfer", overrides);

/** An incoming transfer of EUR, bank id 2949 */
export const rawForeignTransferReceive = (overrides: Json = {}) =>
	ipkoExample("REALIZED_DPW/foreign_transfer_in", overrides);

/** A hold on the card, bank id 2968 */
export const rawHold = (overrides: Json = {}) => ipkoExample("HOLD/card_payment", overrides);

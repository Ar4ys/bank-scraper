import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { z } from "zod";

import { zMdu } from "./zod.ts";

const card = z
	.object({
		kind: z.literal("CARD"),
		meta: z.object({ side: z.enum(["DEBIT", "CREDIT"]) }),
		amount: z.number(),
	})
	.describe("card");
const transfer = z
	.object({
		kind: z.literal(["TRANSFER", "TRANSFER_IN"]),
		meta: z.object({ side: z.literal("DEBIT") }),
		title: z.string(),
	})
	.describe("transfer");
// A discriminator that is not a literal or an enum is checked by parsing it
const other = z
	.object({
		kind: z.string().startsWith("OTHER"),
		meta: z.object({ side: z.literal("CREDIT") }),
		note: z.string(),
	})
	.describe("other");

const union = zMdu({ kind: true, meta: { side: true } }, [card, transfer, other]);

const customCodes = (value: unknown) => {
	const result = union.safeParse(value);
	return result.success
		? "success"
		: result.error.issues.map((issue) =>
				"code_custom" in issue ? String(issue.code_custom) : issue.code,
			);
};

describe("zMdu", () => {
	it("parses a value with the schema its discriminators pick", () => {
		assert.deepEqual(union.parse({ kind: "CARD", meta: { side: "CREDIT" }, amount: 1 }), {
			kind: "CARD",
			meta: { side: "CREDIT" },
			amount: 1,
		});
		assert.deepEqual(
			union.parse({ kind: "TRANSFER_IN", meta: { side: "DEBIT" }, title: "t", extra: 1 }),
			{ kind: "TRANSFER_IN", meta: { side: "DEBIT" }, title: "t" },
		);
		assert.deepEqual(union.parse({ kind: "OTHER-1", meta: { side: "CREDIT" }, note: "n" }), {
			kind: "OTHER-1",
			meta: { side: "CREDIT" },
			note: "n",
		});
	});

	it("reports a value no schema's discriminators accept", () => {
		for (const value of [
			{ kind: "CASH", meta: { side: "DEBIT" } },
			{ kind: "TRANSFER", meta: { side: "CREDIT" }, title: "t" },
			{ kind: "CARD", meta: { side: "SIDEWAYS" }, amount: 1 },
			{ kind: "CARD", amount: 1 },
			{ kind: "CARD", meta: [], amount: 1 },
			{ kind: "CARD", meta: null, amount: 1 },
			"not an object",
			null,
		]) {
			assert.deepEqual(customCodes(value), ["invalid_mdu"], JSON.stringify(value));
		}
	});

	it("reports the issues of the schema the discriminators pick", () => {
		const result = union.safeParse({ kind: "CARD", meta: { side: "DEBIT" }, amount: "1" });

		assert.equal(result.success, false);
		assert.deepEqual(
			result.error?.issues.map((issue) => [issue.code, issue.path]),
			[["invalid_type", ["amount"]]],
		);
	});

	it("checks a discriminator that is not a literal or an enum by parsing it", () => {
		assert.deepEqual(customCodes({ kind: "OTHER", meta: { side: "CREDIT" }, note: 1 }), [
			"invalid_type",
		]);
		assert.deepEqual(customCodes({ kind: "NOPE", meta: { side: "CREDIT" }, note: "n" }), [
			"invalid_mdu",
		]);
	});
});

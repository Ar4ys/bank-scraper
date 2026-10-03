import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { z } from "zod";

import { TransactionAmount, zPlainDate, zTransactionAmount } from "./codecs.ts";

describe("zTransactionAmount", () => {
	const cases: Array<[string, bigint]> = [
		["12.34", 1234n],
		["10.00", 1000n],
		["0.05", 5n],
		["-0.50", -50n],
		["-12.34", -1234n],
	];

	for (const [text, minorUnits] of cases) {
		it(`decodes "${text}" to ${minorUnits}n`, () => {
			assert.equal(z.decode(zTransactionAmount, text), minorUnits);
		});

		it(`encodes ${minorUnits}n to "${text}"`, () => {
			assert.equal(z.encode(zTransactionAmount, TransactionAmount(minorUnits)), text);
		});
	}

	it("decodes an amount without a fractional part", () => {
		assert.equal(z.decode(zTransactionAmount, "7"), 700n);
		assert.equal(z.decode(zTransactionAmount, "-7"), -700n);
	});

	for (const invalid of ["abc1.5xyz", "12.5", "1.234", "1,00", " 1.00", "", "--1.00"]) {
		it(`rejects "${invalid}"`, () => {
			assert.equal(z.safeDecode(zTransactionAmount, invalid).success, false);
		});
	}
});

describe("zPlainDate", () => {
	it("decodes an ISO date", () => {
		const date = z.decode(zPlainDate, "2026-08-17");
		assert.ok(date.equals(Temporal.PlainDate.from({ year: 2026, month: 8, day: 17 })));
	});

	it("rejects text that is not a date", () => {
		assert.equal(z.safeDecode(zPlainDate, "BOLT.EU").success, false);
	});

	it("encodes back to an ISO date", () => {
		assert.equal(z.encode(zPlainDate, Temporal.PlainDate.from("2026-08-17")), "2026-08-17");
	});
});

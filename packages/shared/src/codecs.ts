import { z } from "zod";

import { createBrander, type Branded } from "./brand.ts";

/** Amount of money in minor units (1/100 of the currency) */
export type TransactionAmount = Branded<bigint, "TransactionAmount">;
export const TransactionAmount = createBrander<bigint, TransactionAmount>();

export const zPlainDate = z.codec(z.string(), z.instanceof(Temporal.PlainDate), {
	decode: (value) => Temporal.PlainDate.from(value),
	encode: (value) => value.toString(),
});

export const zTransactionAmount = z.codec(
	z.string().regex(/^-?\d+(\.\d{2})?$/, "Transaction amount must have format: 0.00 or -0.00"),
	z.custom<TransactionAmount>((value) => typeof value === "bigint"),
	{
		decode: (value) =>
			TransactionAmount(BigInt(!value.includes(".") ? value + "00" : value.replace(".", ""))),
		encode: (value) => {
			// Sign is handled separately, because the integer part of e.g. -0.50 is 0n and loses it
			const sign = value < 0n ? "-" : "";
			const absolute = value < 0n ? -BigInt(value) : value;
			const fractionalPart = String(absolute % 100n).padStart(2, "0");

			return `${sign}${absolute / 100n}.${fractionalPart}`;
		},
	},
);

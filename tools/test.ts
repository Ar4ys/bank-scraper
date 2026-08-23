import fs from "node:fs/promises";

import { isEqual } from "es-toolkit";
import JSONC from "jsonc-simple-parser";
import { z } from "zod";

// const transactionSchema = z.object({
// 	operation_id: z.string(),
// 	date: z.string(),
// 	money: z.object({ amount: z.string(), currency: z.string() }),
// 	title: z.string(),
// 	operation_kind: z.object({ code: z.string(), side: z.string() }),
// 	operation_type: z.string(),
// 	details: z.object({
// 		exec_date: z.string(),
// 		hold_registration_date: z.optional(z.string()),
// 		operation_kind: z.object({ code: z.string(), side: z.string() }),
// 		money: z.object({ amount: z.string(), currency: z.string() }),
// 		title: z.string(),
// 		address: z.optional(z.string()),
// 		city: z.optional(z.string()),
// 		country: z.optional(z.string()),
// 		country_code: z.optional(z.string()),
// 		merchant_name: z.optional(z.string()),
// 		category: z.optional(z.string()),
// 		order_date: z.optional(z.string()),
// 		subcategories: z.optional(z.string()),
// 		phone_number: z.optional(
// 			z.object({
// 				country_code: z.string(),
// 				number: z.string(),
// 			}),
// 		),
// 		transaction_id: z.optional(z.string()),
// 		other_account: z.optional(z.string()),
// 		recipient_name_and_address: z.optional(z.string()),
// 		card_number: z.optional(z.string()),
// 		oper_date_time: z.optional(z.string()),
// 		settlement_date: z.optional(z.string()),
// 		original_amount: z.optional(
// 			z.object({
// 				amount: z.string(),
// 				currency: z.string(),
// 			}),
// 		),
// 		sender_name_and_address: z.optional(z.string()),
// 	}),
// 	avatar_url: z.nullable(z.string()),
// 	google_place_id: z.nullable(z.string()),
// 	coordinates: z.object({
// 		latitude: z.nullable(z.string()),
// 		longitude: z.nullable(z.string()),
// 	}),
// 	other_side: z.nullable(z.string()),
// 	is_hold: z.boolean(),
// 	is_other_side_recipient: z.nullable(z.boolean()),
// });

// const [a, b] = JSONC.parse(await fs.readFile("./data.jsonc", "utf8"));

// const transactions = [...a.response.data.items, ...b.response.data.next_items].map((t) =>
// 	transactionSchema.parse(t),
// );

// for (const t of transactions) {
// 	// if (isEqual(t.title, t.details.title)) continue;

// 	console.log({
// 		equal: isEqual(t.title, t.details.title),
// 		id: t.operation_id,
// 		title: t.title,
// 		operation_kind: t.operation_kind,
// 		operation_type: t.operation_type,
// 		details: t.details,
// 	});
// }
//
//
//
const a = z
	.discriminatedUnion("a", [
		z.object({ a: z.literal(1), b: z.string() }),
		z.object({ a: z.literal(2) }),
	])
	.safeParse({ a: 3 });

if (a.success) {
	console.dir(a.data);
} else {
	console.log(z.prettifyError(a.error));
	console.log();
	console.dir(z.treeifyError(a.error), { depth: 10 });
	console.log();
	console.dir(a.error.issues, { depth: 10 });
}

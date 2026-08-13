import "./global";
import { z } from "zod/mini";

import { asyncSpyOn } from "./utils";

const INTERCEPT_URL = "/ipko3/accounts/operations/completed/full";

const transactionSchema = z.object({
	operation_id: z.string(),
	date: z.string(),
	money: z.object({ amount: z.string(), currency: z.string() }),
	title: z.string(),
	operation_kind: z.object({ code: z.string(), side: z.string() }),
	operation_type: z.string(),
	details: z.object({
		exec_date: z.string(),
		hold_registration_date: z.optional(z.string()),
		operation_kind: z.object({ code: z.string(), side: z.string() }),
		money: z.object({ amount: z.string(), currency: z.string() }),
		title: z.string(),
		address: z.optional(z.string()),
		city: z.optional(z.string()),
		country: z.optional(z.string()),
		country_code: z.optional(z.string()),
		merchant_name: z.optional(z.string()),
		category: z.optional(z.string()),
		order_date: z.optional(z.string()),
		subcategories: z.optional(z.string()),
		phone_number: z.optional(
			z.object({
				country_code: z.string(),
				number: z.string(),
			}),
		),
		transaction_id: z.optional(z.string()),
		other_account: z.optional(z.string()),
		recipient_name_and_address: z.optional(z.string()),
		card_number: z.optional(z.string()),
		oper_date_time: z.optional(z.string()),
		settlement_date: z.optional(z.string()),
		original_amount: z.optional(
			z.object({
				amount: z.string(),
				currency: z.string(),
			}),
		),
		sender_name_and_address: z.optional(z.string()),
	}),
	avatar_url: z.nullable(z.string()),
	google_place_id: z.nullable(z.string()),
	coordinates: z.object({
		latitude: z.nullable(z.string()),
		longitude: z.nullable(z.string()),
	}),
	other_side: z.nullable(z.string()),
	is_hold: z.boolean(),
	is_other_side_recipient: z.nullable(z.boolean()),
});

const fullCompletedOperationsSchema = z.pipe(
	z.intersection(
		z.object({
			ref_operations_download_preferences: z.object({
				data: z.object({
					source_account: z.string(),
				}),
			}),
		}),
		z.union([
			z.object({ items: z.array(transactionSchema) }),
			z.object({ next_items: z.array(transactionSchema) }),
		]),
	),
	z.transform((obj) => ({
		ref_operations_download_preferences:
			obj.ref_operations_download_preferences,
		items: "items" in obj ? obj.items : obj.next_items,
	})),
);

const resBodySchema = z.object({
	httpStatus: z.literal(200),
	response: z.object({ data: fullCompletedOperationsSchema }),
});

asyncSpyOn(unsafeWindow, "fetch", async ([url, options], response) => {
	if (url !== INTERCEPT_URL || options?.method !== "POST" || !response.ok) {
		return;
	}

	let json;

	try {
		json = await response.clone().json();
	} catch (e) {
		console.error("Unable to clone and parse response as a json:", e);
	}

	const resBody = resBodySchema.parse(json);
	console.log("SWEET SWEET MONEY", resBody);
});

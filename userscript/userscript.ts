import "./global";
import { z } from "zod/mini";

import { asyncSpyOn, defer } from "./utils";

const INTERCEPT_URL = "/ipko3/accounts/operations/completed/full";

// Strict transaction validation and processing will happen on backend
const transactionSchema = z.pipe(
	z.looseObject({
		operation_id: z.string(),
	}),
	z.transform((t) => {
		// Looks like it just returns the requested query back - not very useful for us
		delete t.ref_recipient_history;
		return t;
	}),
);

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
		ref_operations_download_preferences: obj.ref_operations_download_preferences,
		items: "items" in obj ? obj.items : obj.next_items,
	})),
);

const resBodySchema = z.object({
	httpStatus: z.literal(200),
	response: z.object({ data: fullCompletedOperationsSchema }),
});

const createTransactionsResponse = z.array(z.unknown());

async function processResponseBody(body: unknown) {
	const { data, error } = resBodySchema.safeParse(body);

	if (error) {
		console.error("Response does not satisfy schema:", error);
		return;
	}

	const transactions = data.response.data.items.map((transaction) => ({
		bankId: transaction.operation_id,
		data: transaction,
	}));

	const response = await GM.fetch("http://localhost:8585/api/transactions/raw", {
		method: "POST",
		body: JSON.stringify(transactions),
		headers: {
			"Content-Type": "application/json",
		},
	});

	if (!response.ok) {
		console.error("Request to create transactions failed (see below for more info)");
		console.groupCollapsed("Request Info");
		using _ = defer(() => console.groupEnd());

		console.log("Request Body", transactions);
		console.log("Response", response);

		const responseData = await response
			.json()
			.then((value) => value ?? response.text())
			.catch(() => "<failed to read response body>");

		console.log("Response Body", responseData);
		return;
	}

	let resBody: unknown;

	try {
		resBody = await response.json();
	} catch (e) {
		console.error("Could not parse create transactions response as json", e);
		return;
	}

	const resBodyValid = createTransactionsResponse.safeParse(resBody);

	if (!resBodyValid.success) {
		console.error("Create transaction response does not satisfy schema:", resBodyValid.error);
		return;
	}

	if (resBodyValid.data.length) {
		console.log(`Created new transactions: ${resBodyValid.data.length}`);
	} else {
		console.log("No new transactions created");
	}
}

asyncSpyOn(unsafeWindow, "fetch", async ([url, options], response) => {
	if (url !== INTERCEPT_URL || options?.method !== "POST" || !response.ok) {
		return;
	}

	let json: unknown;

	try {
		json = await response.clone().json();
	} catch (e) {
		console.error("Unable to clone and parse response as a json:", e);
		return;
	}

	try {
		await Promise.try(() => processResponseBody(json));
	} catch (e) {
		console.error("Unable to process response:", e);
	}
});

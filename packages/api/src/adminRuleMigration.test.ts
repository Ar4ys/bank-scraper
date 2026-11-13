import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { createTestDb } from "./db/testDb.ts";
import { rawCardTransaction } from "./processing/fixtures.ts";

const { cleanup } = await createTestDb();
const { ingestRawTransactions } = await import("./ingest.ts");
const { app } = await import("./app.ts");
after(cleanup);

const cardPayment = (bankId: string, address: string, merchantName?: string) => ({
	bankId,
	data: rawCardTransaction({
		operation_id: bankId,
		details: { address, ...(merchantName ? { merchant_name: merchantName } : {}) },
	}),
});

await ingestRawTransactions({
	accountNumber: "PL00",
	transactions: [
		cardPayment("acme-1", "ACME 0001"),
		cardPayment("acme-2", "ACME 0002", "Acme Bank Name"),
		cardPayment("cafe-1", "CORNER  CAFE"),
		cardPayment("mart-1", "MART 24"),
	],
});

async function request(path: string, method = "GET", body?: unknown) {
	const response = await app.request(`/api/admin${path}`, {
		method,
		headers: body === undefined ? undefined : { "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	return { status: response.status, body: (await response.json()) as any };
}

const paymentTypes = ["cardTransaction", "mobileTransaction"];

const rules = [
	{
		name: "Acme",
		enabled: true,
		txTypes: paymentTypes,
		conditions: [{ path: "details.address", operator: "contains", pattern: "ACME" }],
		set: { merchant: "Acme" },
	},
	{
		name: "Places",
		enabled: true,
		txTypes: paymentTypes,
		conditions: [
			{ path: "details.address", operator: "regex", pattern: "((?:CORNER  CAFE)|(?:MART))" },
		],
		set: { merchant: "{match.1}" },
	},
	{
		name: "Description",
		enabled: true,
		txTypes: null,
		conditions: [],
		set: { description: "Paid" },
	},
];

const merchants = async () =>
	(await request("/transactions")).body.items
		.map((item: any) => [item.bankId, item.merchant])
		.toSorted();

const move = (dryRun: boolean) => request(`/rules/move-to-merchant-map?dryRun=${dryRun}`, "POST");

// The tests build on each other: rules applied, refused, previewed, moved
describe("moving rules to the merchant map", () => {
	it("starts from rules that name every merchant", async () => {
		await request("/rules", "PUT", { rules });
		assert.equal((await request("/rules/apply", "POST")).status, 200);

		assert.deepEqual(await merchants(), [
			["acme-1", "Acme"],
			["acme-2", "Acme"],
			["cafe-1", "CORNER  CAFE"],
			["mart-1", "MART"],
		]);
	});

	it("refuses while the rules have edits that are not applied", async () => {
		const applied = (await request("/rules")).body.rules.map(
			({ priority: _priority, ...rule }: any) => rule,
		);
		await request("/rules", "PUT", { rules: applied.toReversed() });
		const { status, body } = await move(true);

		assert.equal(status, 409);
		assert.match(body.message, /Apply or discard/);

		await request("/rules", "PUT", { rules: applied });
		assert.equal((await request("/rules")).body.hasUnappliedChanges, false);
	});

	it("previews the move without writing anything", async () => {
		const { status, body } = await move(true);

		assert.equal(status, 200);
		assert.equal(body.entryCount, 3);
		assert.deepEqual(body.convertedRules, ["Acme", "Places"]);
		assert.deepEqual(body.keptRules, [
			{ name: "Description", reason: "not limited to card and mobile payments" },
		]);
		// The bank names this one, so the map leaves it alone
		assert.deepEqual(
			body.changes.map((change: any) => [change.bankId, change.after.merchant]),
			[["acme-2", "Acme Bank Name"]],
		);
		assert.deepEqual((await request("/merchant-map")).body, []);
		assert.equal((await request("/rules")).body.rules.length, 3);
	});

	it("replaces the converted rules with map entries", async () => {
		const { status } = await move(false);
		assert.equal(status, 200);

		assert.deepEqual(
			(await request("/merchant-map")).body.map((entry: any) => [
				entry.text,
				entry.merchant,
				entry.transactionCount,
			]),
			[
				["ACME", "Acme", 1],
				["CORNER  CAFE", "CORNER  CAFE", 1],
				["MART", "MART", 1],
			],
		);

		const { rules: left, hasUnappliedChanges } = (await request("/rules")).body;
		assert.deepEqual(
			left.map((rule: any) => rule.name),
			["Description"],
		);
		assert.equal(hasUnappliedChanges, false);

		assert.deepEqual(await merchants(), [
			["acme-1", "Acme"],
			["acme-2", "Acme Bank Name"],
			["cafe-1", "CORNER  CAFE"],
			["mart-1", "MART"],
		]);
	});

	it("refuses texts that match alike but name different merchants", async () => {
		await request("/rules", "PUT", {
			rules: [
				{
					name: "Other cafe",
					enabled: true,
					txTypes: paymentTypes,
					conditions: [{ path: "details.address", operator: "contains", pattern: "corner cafe" }],
					set: { merchant: "Another Cafe" },
				},
			],
		});
		await request("/rules/apply", "POST");

		const { status, body } = await move(true);
		assert.equal(status, 409);
		assert.match(body.message, /- address "CORNER {2}CAFE": "CORNER {2}CAFE", "Another Cafe"/);
	});
});

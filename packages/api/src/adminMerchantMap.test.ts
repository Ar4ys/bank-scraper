import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { createTestDb } from "./db/testDb.ts";
import { rawCardTransaction } from "./processing/fixtures.ts";

const { cleanup } = await createTestDb();
const { ingestRawTransactions } = await import("./ingest.ts");
const { app } = await import("./app.ts");
after(cleanup);

/** A card payment for which the bank names no merchant */
const cardPaymentAt = (bankId: string, address: string) => ({
	bankId,
	data: rawCardTransaction({ operation_id: bankId, details: { address } }),
});

await ingestRawTransactions({
	accountNumber: "PL00",
	transactions: [
		cardPaymentAt("mart-1", "MART 0001"),
		cardPaymentAt("mart-2", "SUPERMART 24"),
		cardPaymentAt("cafe-1", "CORNER  CAFE"),
		{
			bankId: "named-1",
			data: rawCardTransaction({
				operation_id: "named-1",
				details: { address: "MART 0002", merchant_name: "Mart Polska" },
			}),
		},
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

const listEntries = async () => (await request("/merchant-map")).body;

/** `[bankId, merchant]` of every transaction */
const merchants = async () =>
	(await request("/transactions")).body.items
		.map((item: any) => [item.bankId, item.merchant])
		.toSorted();

const transactionId = async (bankId: string) =>
	(await request("/transactions")).body.items.find((item: any) => item.bankId === bankId).id;

const history = async (bankId: string) =>
	(await request(`/transactions/${await transactionId(bankId)}`)).body.versions.map(
		(version: any) => [
			version.cause,
			version.data.merchant,
			version.fieldRules.map((rule: any) => rule.ruleName),
		],
	);

// The tests build on each other: add, preview, change, delete
describe("admin merchant map API", () => {
	it("previews a new entry without writing anything", async () => {
		const before = await merchants();
		const { status, body } = await request("/merchant-map?dryRun=true", "POST", {
			field: "address",
			text: "MART",
			merchant: "Mart",
		});

		assert.equal(status, 200);
		assert.deepEqual(body.changes.map((change: any) => change.after.merchant).toSorted(), [
			"Mart",
			"Mart",
		]);
		assert.deepEqual(Object.values(body.sourceNames), ['Map: "MART" → Mart']);
		assert.deepEqual(await listEntries(), []);
		assert.deepEqual(await merchants(), before);
	});

	it("gives the matching payments without a bank merchant the entry's merchant", async () => {
		const { status } = await request("/merchant-map", "POST", {
			field: "address",
			text: " MART ",
			merchant: "Mart",
		});

		assert.equal(status, 200);
		assert.deepEqual(await merchants(), [
			["cafe-1", null],
			["mart-1", "Mart"],
			["mart-2", "Mart"],
			["named-1", "Mart Polska"],
		]);
		assert.deepEqual(
			(await listEntries()).map((entry: any) => [entry.text, entry.transactionCount]),
			[["MART", 2]],
		);
		assert.deepEqual((await history("mart-1")).at(-1), [
			"merchant-map",
			"Mart",
			['Map: "MART" → Mart'],
		]);
	});

	it("lets the longest text win and collapses whitespace", async () => {
		await request("/merchant-map", "POST", {
			field: "address",
			text: "SUPERMART",
			merchant: "Supermart",
		});
		await request("/merchant-map", "POST", {
			field: "address",
			text: "corner cafe",
			merchant: "Corner Cafe",
		});

		assert.deepEqual(await merchants(), [
			["cafe-1", "Corner Cafe"],
			["mart-1", "Mart"],
			["mart-2", "Supermart"],
			["named-1", "Mart Polska"],
		]);
	});

	it("refuses an entry that matches the same text as another one", async () => {
		const { status, body } = await request("/merchant-map", "POST", {
			field: "address",
			text: "Corner   Cafe",
			merchant: "Something else",
		});

		assert.equal(status, 409);
		assert.match(body.message, /corner cafe/);
	});

	it("accepts the same text for another field", async () => {
		const { status } = await request("/merchant-map?dryRun=true", "POST", {
			field: "city",
			text: "corner cafe",
			merchant: "Corner Cafe",
		});

		assert.equal(status, 200);
	});

	it("changes an entry", async () => {
		const supermart = (await listEntries()).find((entry: any) => entry.text === "SUPERMART");
		const { status } = await request(`/merchant-map/${supermart.id}`, "PATCH", {
			merchant: "Supermart 24",
		});

		assert.equal(status, 200);
		assert.deepEqual(
			(await merchants()).find(([bankId]: string[]) => bankId === "mart-2"),
			["mart-2", "Supermart 24"],
		);
	});

	it("deletes an entry, and the history still says a map entry set the merchant", async () => {
		const supermart = (await listEntries()).find((entry: any) => entry.text === "SUPERMART");
		const { status } = await request(`/merchant-map/${supermart.id}`, "DELETE");

		assert.equal(status, 200);
		assert.deepEqual(
			(await merchants()).find(([bankId]: string[]) => bankId === "mart-2"),
			["mart-2", "Mart"],
		);
		assert.deepEqual(
			(await history("mart-2")).map(([, merchant, rules]: [string, string, string[]]) => [
				merchant,
				rules,
			]),
			[
				[null, []],
				["Mart", ['Map: "MART" → Mart']],
				["Supermart", ["Map entry (deleted)"]],
				["Supermart 24", ["Map entry (deleted)"]],
				["Mart", ['Map: "MART" → Mart']],
			],
		);
	});

	it("answers 404 for an unknown entry", async () => {
		assert.equal((await request("/merchant-map/unknown", "DELETE")).status, 404);
		assert.equal((await request("/merchant-map/unknown", "PATCH", { text: "x" })).status, 404);
	});

	it("rejects an empty text", async () => {
		const { status } = await request("/merchant-map", "POST", {
			field: "address",
			text: "   ",
			merchant: "Nothing",
		});

		assert.equal(status, 400);
	});
});

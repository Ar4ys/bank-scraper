import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { createTestDb } from "./db/testDb.ts";
import { rawCardTransaction, rawTransferSend } from "./processing/fixtures.ts";

const { cleanup } = await createTestDb();
const { ingestRawTransactions } = await import("./ingest.ts");
const { app } = await import("./app.ts");
after(cleanup);

const cardPayment = (bankId: string, address: string, date: string, merchantName?: string) => ({
	bankId,
	data: rawCardTransaction({
		operation_id: bankId,
		details: {
			address,
			order_date: date,
			...(merchantName ? { merchant_name: merchantName } : {}),
		},
	}),
});

await ingestRawTransactions({
	accountNumber: "PL00",
	transactions: [
		cardPayment("lidl-1", "LIDL 3011", "2026-01-05"),
		cardPayment("lidl-2", "LIDL 3012", "2026-02-05"),
		cardPayment("lidl-3", "LIDL3012", "2026-03-05"),
		cardPayment("lidl-4", "LIDL 3024", "2026-04-05"),
		cardPayment("cafe-1", "CORNER CAFE", "2026-01-10"),
		cardPayment("cafe-2", "CORNER  CAFE", "2026-01-11"),
		cardPayment("cafe-3", "corner cafe", "2026-01-12"),
		cardPayment("once-1", "SEEN ONCE", "2026-01-01"),
		cardPayment("twice-1", "SEEN TWICE", "2026-01-01"),
		cardPayment("twice-2", "SEEN TWICE", "2026-01-02"),
		cardPayment("named-1", "MART 1", "2026-01-01", "Mart"),
		cardPayment("named-2", "MART 2", "2026-01-02", "Mart"),
		cardPayment("named-3", "MART 3", "2026-01-03", "Mart"),
		{ bankId: "transfer-1", data: rawTransferSend() },
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

const places = async () => (await request("/merchant-map/places")).body;

// The tests build on each other: listed, a merchant deleted, a place named
describe("places without a merchant", () => {
	it("lists recurring places of payments without a merchant, the most payments first", async () => {
		assert.deepEqual(
			(await places()).map(({ transactions: _transactions, ...place }: any) => place),
			[
				{
					key: "lidl",
					payments: 4,
					firstDate: "2026-01-05",
					lastDate: "2026-04-05",
					addresses: [
						{ address: "LIDL 3011", payments: 1 },
						{ address: "LIDL 3012", payments: 1 },
						{ address: "LIDL 3024", payments: 1 },
						{ address: "LIDL3012", payments: 1 },
					],
					proposedText: "LIDL",
				},
				{
					key: "corner cafe",
					payments: 3,
					firstDate: "2026-01-10",
					lastDate: "2026-01-12",
					addresses: [
						{ address: "CORNER  CAFE", payments: 1 },
						{ address: "corner cafe", payments: 1 },
						{ address: "CORNER CAFE", payments: 1 },
					],
					proposedText: "CORNER CAFE",
				},
			],
		);
	});

	it("lists every payment of a place, the newest first", async () => {
		const [lidl] = await places();
		const { items } = (await request("/transactions")).body;
		const idOf = (bankId: string) => items.find((item: any) => item.bankId === bankId).id;

		assert.deepEqual(
			lidl.transactions.map((payment: any) => [
				payment.transactionId,
				payment.date,
				payment.amount,
				payment.currency,
				payment.description,
			]),
			[
				[idOf("lidl-4"), "2026-04-05", "-57.33", "PLN", "LIDL 3024, Wroclaw, POLSKA"],
				[idOf("lidl-3"), "2026-03-05", "-57.33", "PLN", "LIDL3012, Wroclaw, POLSKA"],
				[idOf("lidl-2"), "2026-02-05", "-57.33", "PLN", "LIDL 3012, Wroclaw, POLSKA"],
				[idOf("lidl-1"), "2026-01-05", "-57.33", "PLN", "LIDL 3011, Wroclaw, POLSKA"],
			],
		);
	});

	it("leaves out payments the bank names a merchant for, even when that merchant is deleted", async () => {
		const mart = (await request("/merchants")).body.find(
			(merchant: any) => merchant.name === "Mart",
		);
		await request(`/merchants/${mart.id}`, "DELETE");

		assert.deepEqual(
			(await places()).map((place: any) => place.key),
			["lidl", "corner cafe"],
		);
	});

	it("drops a place a map entry names, and lists it again when that merchant is deleted", async () => {
		await request("/merchant-map", "POST", {
			field: "address",
			text: "corner cafe",
			merchant: "Corner Cafe",
		});
		assert.deepEqual(
			(await places()).map((place: any) => place.key),
			["lidl"],
		);

		const cafe = (await request("/merchants")).body.find(
			(merchant: any) => merchant.name === "Corner Cafe",
		);
		await request(`/merchants/${cafe.id}`, "DELETE");
		assert.deepEqual(
			(await places()).map((place: any) => place.key),
			["lidl", "corner cafe"],
		);
	});

	it("drops a place once a map entry names it", async () => {
		await request("/merchant-map", "POST", { field: "address", text: "LIDL", merchant: "Lidl" });

		assert.deepEqual(
			(await places()).map((place: any) => place.key),
			["corner cafe"],
		);
	});
});

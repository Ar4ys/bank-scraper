import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { createTestDb } from "./db/testDb.ts";
import { ipkoExample, rawCardTransaction, rawTransferSend } from "./processing/fixtures.ts";

const { cleanup } = await createTestDb();
const { ingestRawTransactions } = await import("./ingest.ts");
const { app } = await import("./app.ts");
const { titleCase } = await import("./processing/people.ts");
after(cleanup);

const sent = (bankId: string, name: string, date: string) => ({
	bankId,
	data: rawTransferSend({
		operation_id: bankId,
		other_side: name,
		details: { recipient_name_and_address: name, order_date: date },
	}),
});
const received = (bankId: string, name: string, date: string) => ({
	bankId,
	data: ipkoExample("TRANSFER_NORMAL/blik_transfer_receive", {
		operation_id: bankId,
		other_side: name,
		details: { sender_name_and_address: name, order_date: date },
	}),
});
const paypal = (bankId: string, date: string) => ({
	bankId,
	data: ipkoExample("CARD_TRANSACTION/card_transfer", {
		operation_id: bankId,
		details: { order_date: date },
	}),
});

await ingestRawTransactions({
	accountNumber: "PL00",
	transactions: [
		sent("jan-1", "JAN KOWALSKI", "2026-01-05"),
		sent("jan-2", "Jan  Kowalski", "2026-02-05"),
		received("jan-3", "JAN KOWALSKI", "2026-03-05"),
		sent("anna-1", "ANNA", "2026-01-01"),
		sent("anna-2", "ANNA", "2026-01-02"),
		sent("joanna-1", "JOANNA", "2026-01-03"),
		paypal("paypal-1", "2026-01-10"),
		paypal("paypal-2", "2026-01-11"),
		paypal("paypal-3", "2026-01-12"),
		{
			bankId: "card-1",
			data: rawCardTransaction({ operation_id: "card-1", details: { address: "JAN KOWALSKI" } }),
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

const people = async () => (await request("/merchant-map/people")).body;
const merchantOf = async (bankId: string) =>
	(await request("/transactions")).body.items.find((item: any) => item.bankId === bankId).merchant;

describe("titleCase", () => {
	it("capitalizes the first letter of every word", () => {
		assert.equal(titleCase("JAN KOWALSKI"), "Jan Kowalski");
		assert.equal(titleCase("PAYPAL *USER_NAME"), "Paypal *User_name");
		assert.equal(titleCase("ŁUKASZ ŻAK"), "Łukasz Żak");
	});
});

// The tests build on each other: listed, a person named, one ignored and restored
describe("people without a merchant", () => {
	it("lists counterparties of three transfers and more, sent and received together", async () => {
		assert.deepEqual(
			(await people()).map(({ transactions, ...person }: any) => ({
				...person,
				transactions: transactions.map((item: any) => item.date),
			})),
			[
				{
					key: "counterparty:jan kowalski",
					payments: 3,
					sent: 2,
					received: 1,
					firstDate: "2026-01-05",
					lastDate: "2026-03-05",
					names: [
						{ name: "JAN KOWALSKI", payments: 2 },
						{ name: "Jan  Kowalski", payments: 1 },
					],
					proposedText: "JAN KOWALSKI",
					proposedMerchant: "Jan Kowalski",
					transactions: ["2026-03-05", "2026-02-05", "2026-01-05"],
					ignored: null,
				},
				{
					key: "counterparty:paypal *user_name",
					payments: 3,
					sent: 3,
					received: 0,
					firstDate: "2026-01-10",
					lastDate: "2026-01-12",
					names: [{ name: "PAYPAL *USER_NAME", payments: 3 }],
					proposedText: "PAYPAL *USER_NAME",
					proposedMerchant: "Paypal *User_name",
					transactions: ["2026-01-12", "2026-01-11", "2026-01-10"],
					ignored: null,
				},
			],
		);
	});

	it("names a person with a counterparty entry, which never overrides the bank", async () => {
		const added = await request("/merchant-map?dryRun=false", "POST", {
			field: "counterparty",
			text: "JAN KOWALSKI",
			merchant: "Jan Kowalski",
			overridesBankMerchant: true,
		});
		assert.equal(added.status, 200);

		assert.deepEqual(await Promise.all(["jan-1", "jan-2", "jan-3", "card-1"].map(merchantOf)), [
			"Jan Kowalski",
			"Jan Kowalski",
			"Jan Kowalski",
			null,
		]);
		const entry = (await request("/merchant-map")).body.find(
			(item: any) => item.text === "JAN KOWALSKI",
		);
		assert.equal(entry.overridesBankMerchant, false);
		assert.deepEqual(
			(await people()).map((person: any) => person.key),
			["counterparty:paypal *user_name"],
		);

		const coverage = await request(`/merchant-map/${entry.id}/coverage`);
		assert.deepEqual([coverage.body.matching, coverage.body.set, coverage.body.others], [3, 3, []]);
	});

	it("ignores and restores a person like a place", async () => {
		const key = "counterparty:paypal *user_name";
		await request("/merchant-map/places/ignore", "POST", { key, forever: false });

		assert.deepEqual((await people())[0].ignored, {
			forever: false,
			ignoredOn: Temporal.Now.plainDateISO().toString(),
		});
		assert.deepEqual(
			(await request("/merchant-map/places")).body.map((place: any) => place.key),
			[],
		);

		await request("/merchant-map/places/restore", "POST", { key });
		assert.equal((await people())[0].ignored, null);
	});
});

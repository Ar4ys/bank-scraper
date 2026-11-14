import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { createTestDb } from "./db/testDb.ts";
import { rawCardTransaction } from "./processing/fixtures.ts";

const { cleanup } = await createTestDb();
const { ingestRawTransactions } = await import("./ingest.ts");
const { app } = await import("./app.ts");
after(cleanup);

const payment = (bankId: string, details: Record<string, string>) => ({
	bankId,
	data: rawCardTransaction({ operation_id: bankId, details }),
});

await ingestRawTransactions({
	accountNumber: "PL00",
	transactions: [
		payment("plain-1", { address: "KIOSK PLAC 1" }),
		payment("plain-2", { address: "KIOSK PLAC 2" }),
		payment("bank-1", { address: "KIOSK BANK 1", merchant_name: "Kiosk Polska" }),
		payment("longer-1", { address: "KIOSK LONGER 1" }),
		payment("rule-1", { address: "KIOSK RULE 1" }),
		payment("other-1", { address: "BAKERY 1" }),
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

const addEntry = (text: string, merchant: string) =>
	request("/merchant-map?dryRun=false", "POST", { field: "address", text, merchant });
const entryId = async (text: string) =>
	(await request("/merchant-map")).body.find((entry: any) => entry.text === text).id;
const transactionId = async (bankId: string) =>
	(await request("/transactions")).body.items.find((item: any) => item.bankId === bankId).id;

await addEntry("KIOSK", "Kiosk");
await addEntry("KIOSK LONGER", "Kiosk Longer");
await request("/rules", "PUT", {
	rules: [
		{
			name: "Kiosk rule",
			enabled: true,
			txTypes: null,
			conditions: [{ path: "details.address", operator: "contains", pattern: "KIOSK RULE" }],
			set: { merchant: "Kiosk by rule" },
		},
	],
});
await request("/rules/apply", "POST");

describe("GET /api/admin/merchant-map/:id/coverage", () => {
	it("counts the payments an entry matches and says what sets the merchant of the rest", async () => {
		const { status, body } = await request(`/merchant-map/${await entryId("KIOSK")}/coverage`);

		assert.equal(status, 200);
		assert.deepEqual([body.matching, body.set], [5, 2]);
		assert.deepEqual(
			body.others.toSorted((a: any, b: any) => a.kind.localeCompare(b.kind)),
			[
				{ kind: "bank", payments: 1 },
				{ kind: "entry", label: 'Map: "KIOSK LONGER" → Kiosk Longer', payments: 1 },
				{ kind: "rule", label: "Kiosk rule", payments: 1 },
			],
		);
	});

	it("answers 404 for an unknown entry", async () => {
		assert.equal((await request("/merchant-map/unknown/coverage")).status, 404);
	});
});

describe("GET /api/admin/transactions/:id", () => {
	it("says what sets each field now", async () => {
		const sourcesOf = async (bankId: string) =>
			Object.fromEntries(
				(await request(`/transactions/${await transactionId(bankId)}`)).body.currentSources.map(
					(item: any) => [item.field, item.name ?? item.source],
				),
			);

		assert.equal((await sourcesOf("plain-1")).merchant, 'Map: "KIOSK" → Kiosk');
		assert.equal((await sourcesOf("rule-1")).merchant, "Kiosk rule");
		assert.equal((await sourcesOf("bank-1")).merchant, "default");
		assert.equal((await sourcesOf("bank-1")).description, "default");
	});
});

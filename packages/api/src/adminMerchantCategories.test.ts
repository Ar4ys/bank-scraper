import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { createTestDb } from "./db/testDb.ts";
import { rawCardTransaction } from "./processing/fixtures.ts";

const { cleanup } = await createTestDb();
const { ingestRawTransactions } = await import("./ingest.ts");
const { app } = await import("./app.ts");
after(cleanup);

const cardPayment = (bankId: string, merchantName: string) => ({
	bankId,
	data: rawCardTransaction({ operation_id: bankId, details: { merchant_name: merchantName } }),
});

await ingestRawTransactions({
	accountNumber: "PL00",
	transactions: [
		cardPayment("bakery-1", "Bakery"),
		cardPayment("cafe-1", "Cafe"),
		cardPayment("kiosk-1", "Kiosk"),
		cardPayment("shop-1", "Shop"),
		cardPayment("store-1", "Store"),
	],
});

const groceries = "0192b7a4-5c1e-7c3a-9d2f-000000000001";
const dining = "0192b7a4-5c1e-7c3a-9d2f-000000000002";

async function request(path: string, method = "GET", body?: unknown) {
	const response = await app.request(`/api/admin${path}`, {
		method,
		headers: body === undefined ? undefined : { "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	return { status: response.status, body: (await response.json()) as any };
}

const merchantNamed = async (name: string) =>
	(await request("/merchants")).body.find((merchant: any) => merchant.name === name);
const idOf = async (name: string) => (await merchantNamed(name)).id;
const categoryOf = async (name: string) => (await merchantNamed(name)).sureCategoryId;
const setCategory = async (name: string, sureCategoryId: string | null) =>
	request(`/merchants/${await idOf(name)}/category`, "PUT", { sureCategoryId });
const merge = async (name: string, into: string) =>
	request(`/merchants/${await idOf(name)}/merge?dryRun=false`, "POST", {
		intoId: await idOf(into),
	});

describe("categories of merchants", () => {
	it("starts every merchant without a category", async () => {
		assert.equal(await categoryOf("Bakery"), null);
	});

	it("sets and clears a category without reviewing the merchant", async () => {
		assert.equal((await setCategory("Bakery", groceries)).status, 200);
		assert.equal(await categoryOf("Bakery"), groceries);
		assert.equal((await merchantNamed("Bakery")).reviewedAt, null);

		assert.equal((await setCategory("Bakery", null)).status, 200);
		assert.equal(await categoryOf("Bakery"), null);
	});

	it("rejects an unknown merchant and an empty id", async () => {
		assert.equal(
			(await request("/merchants/nope/category", "PUT", { sureCategoryId: groceries })).status,
			404,
		);
		assert.equal((await setCategory("Bakery", "")).status, 400);
	});

	it("keeps the category through a rename and a review", async () => {
		await setCategory("Cafe", dining);
		const id = await idOf("Cafe");

		await request(`/merchants/${id}/review`, "POST");
		await request(`/merchants/${id}?dryRun=false`, "PATCH", { name: "Corner Cafe" });

		assert.equal(await categoryOf("Corner Cafe"), dining);
	});

	it("keeps the category of the merchant that stays in a merge", async () => {
		await setCategory("Kiosk", groceries);

		assert.equal((await merge("Kiosk", "Corner Cafe")).status, 200);
		assert.equal(await categoryOf("Corner Cafe"), dining);
	});

	it("gives the merchant that stays the merged one's category when it has none", async () => {
		await setCategory("Shop", groceries);

		assert.equal((await merge("Shop", "Store")).status, 200);
		assert.equal(await categoryOf("Store"), groceries);
	});

	it("keeps the category of a deleted merchant", async () => {
		const id = await idOf("Store");
		assert.equal((await request(`/merchants/${id}?dryRun=false`, "DELETE")).status, 200);

		assert.equal(await categoryOf("Store"), groceries);
	});
});

describe("Sure's categories without Sure configured", () => {
	it("reports the integration as off", async () => {
		assert.deepEqual((await request("/sure/categories")).body, {
			enabled: false,
			categories: [],
		});
	});
});

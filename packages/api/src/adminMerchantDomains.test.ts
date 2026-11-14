import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { createTestDb } from "./db/testDb.ts";
import { rawCardTransaction } from "./processing/fixtures.ts";

process.env.BRANDFETCH_CLIENT_ID = "test-brandfetch-id";
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
		cardPayment("lidl-1", "Lidl"),
		cardPayment("bakery-1", "Bakery"),
		cardPayment("kiosk-1", "Kiosk"),
		cardPayment("shop-1", "Shop"),
		cardPayment("store-1", "Store"),
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

const merchantNamed = async (name: string) =>
	(await request("/merchants")).body.find((merchant: any) => merchant.name === name);
const idOf = async (name: string) => (await merchantNamed(name)).id;
const domainOf = async (name: string) => (await merchantNamed(name)).domain;
const setDomain = async (name: string, domain: string | null) =>
	request(`/merchants/${await idOf(name)}/domain`, "PUT", { domain });
const merge = async (name: string, into: string) =>
	request(`/merchants/${await idOf(name)}/merge?dryRun=false`, "POST", {
		intoId: await idOf(into),
	});

describe("domains of merchants", () => {
	it("starts every merchant without a domain", async () => {
		assert.equal(await domainOf("Lidl"), null);
	});

	it("stores a URL as its domain and answers with it", async () => {
		const { status, body } = await setDomain("Lidl", "https://www.Lidl.pl/de/");

		assert.equal(status, 200);
		assert.deepEqual(body, { domain: "lidl.pl" });
		assert.equal(await domainOf("Lidl"), "lidl.pl");
		assert.equal((await merchantNamed("Lidl")).reviewedAt, null);
	});

	it("clears the domain with null or blank text", async () => {
		await setDomain("Bakery", "bakery.pl");
		assert.equal((await setDomain("Bakery", null)).status, 200);
		assert.equal(await domainOf("Bakery"), null);

		await setDomain("Bakery", "bakery.pl");
		assert.equal((await setDomain("Bakery", "  ")).status, 200);
		assert.equal(await domainOf("Bakery"), null);
	});

	it("rejects what isn't a domain, and an unknown merchant", async () => {
		const { status, body } = await setDomain("Lidl", "not a domain");

		assert.equal(status, 400);
		assert.match(body.message, /is not a domain/);
		assert.equal(await domainOf("Lidl"), "lidl.pl");

		assert.equal(
			(await request("/merchants/nope/domain", "PUT", { domain: "lidl.pl" })).status,
			404,
		);
	});

	it("keeps the domain of the merchant that stays in a merge", async () => {
		await setDomain("Kiosk", "kiosk.pl");

		assert.equal((await merge("Kiosk", "Lidl")).status, 200);
		assert.equal(await domainOf("Lidl"), "lidl.pl");
	});

	it("gives the merchant that stays the merged one's domain when it has none", async () => {
		await setDomain("Shop", "shop.pl");

		assert.equal((await merge("Shop", "Store")).status, 200);
		assert.equal(await domainOf("Store"), "shop.pl");
	});
});

describe("GET /api/admin/brandfetch", () => {
	it("hands out the configured client id", async () => {
		assert.deepEqual((await request("/brandfetch")).body, { clientId: "test-brandfetch-id" });
	});
});

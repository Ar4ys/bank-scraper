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
		cardPayment("zabka-1", "Żabka"),
		cardPayment("zabka-2", "ZABKA Z1234"),
		cardPayment("zabka-3", "ZABKA Z5678"),
		cardPayment("mart-1", "Mart"),
		cardPayment("mart-2", "Mart Polska Sp. z o.o."),
		cardPayment("cafe-1", "Corner Cafe"),
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

const listMerchants = async () => (await request("/merchants")).body;
const idOf = async (name: string) =>
	(await listMerchants()).find((merchant: any) => merchant.name === name).id;
const reviewed = async (name: string) =>
	(await listMerchants()).find((merchant: any) => merchant.name === name).reviewedAt !== null;

/** Names of the merchants suggested for the named one */
async function suggestionsFor(name: string) {
	const merchants = await listMerchants();
	const nameOf = (id: string) => merchants.find((merchant: any) => merchant.id === id)?.name;
	const { body } = await request("/merchants/suggestions");

	return (body[await idOf(name)] ?? []).map((suggestion: any) => nameOf(suggestion.merchantId));
}

// The tests build on each other: review, rename, dismiss, merge, delete, detach
describe("merchant review", () => {
	it("starts every merchant as to review", async () => {
		assert.deepEqual(
			(await listMerchants()).map((merchant: any) => merchant.reviewedAt),
			[null, null, null, null, null, null],
		);
	});

	it("marks a merchant reviewed, once", async () => {
		const id = await idOf("Corner Cafe");

		assert.equal((await request(`/merchants/${id}/review`, "POST")).status, 200);
		const { reviewedAt } = (await listMerchants()).find((merchant: any) => merchant.id === id);
		assert.notEqual(reviewedAt, null);

		await request(`/merchants/${id}/review`, "POST");
		assert.equal(
			(await listMerchants()).find((merchant: any) => merchant.id === id).reviewedAt,
			reviewedAt,
		);
	});

	it("answers 404 for an unknown merchant", async () => {
		assert.equal((await request("/merchants/unknown/review", "POST")).status, 404);
	});

	it("suggests merchants with alike names", async () => {
		assert.deepEqual((await suggestionsFor("Żabka")).toSorted(), ["ZABKA Z1234", "ZABKA Z5678"]);
		assert.deepEqual(await suggestionsFor("Mart"), ["Mart Polska Sp. z o.o."]);
		assert.deepEqual(await suggestionsFor("Corner Cafe"), []);
	});

	it("marks a renamed merchant reviewed", async () => {
		const id = await idOf("ZABKA Z5678");
		await request(`/merchants/${id}`, "PATCH", { name: "Żabka Centrum" });

		assert.equal(await reviewed("Żabka Centrum"), true);
	});

	it("stops suggesting a pair dismissed as no duplicates, both ways", async () => {
		const zabka = await idOf("Żabka");
		const centrum = await idOf("Żabka Centrum");

		assert.equal(
			(await request(`/merchants/${centrum}/dismiss`, "POST", { otherId: zabka })).status,
			200,
		);
		assert.equal(
			(await request(`/merchants/${zabka}/dismiss`, "POST", { otherId: centrum })).status,
			200,
		);
		assert.deepEqual(await suggestionsFor("Żabka"), ["ZABKA Z1234"]);
		assert.deepEqual(await suggestionsFor("Żabka Centrum"), ["ZABKA Z1234"]);
	});

	it("refuses to dismiss a merchant against itself or an unknown one", async () => {
		const zabka = await idOf("Żabka");

		assert.equal(
			(await request(`/merchants/${zabka}/dismiss`, "POST", { otherId: zabka })).status,
			400,
		);
		assert.equal(
			(await request(`/merchants/${zabka}/dismiss`, "POST", { otherId: "unknown" })).status,
			404,
		);
	});

	it("marks the merchant merged into reviewed, and drops the dismissals of the merged one", async () => {
		const centrum = await idOf("Żabka Centrum");
		const store = await idOf("ZABKA Z1234");
		await request(`/merchants/${centrum}/merge`, "POST", { intoId: store });

		assert.equal(await reviewed("ZABKA Z1234"), true);
		// The dismissal named "Żabka Centrum", which is gone, so the pair is suggested again
		assert.deepEqual(await suggestionsFor("Żabka"), ["ZABKA Z1234"]);
	});

	it("leaves deleted merchants out of the suggestions and keeps their state when restored", async () => {
		const mart = await idOf("Mart");
		await request(`/merchants/${mart}/review`, "POST");
		await request(`/merchants/${mart}`, "DELETE");

		assert.deepEqual(await suggestionsFor("Mart Polska Sp. z o.o."), []);
		assert.equal((await request(`/merchants/${mart}/review`, "POST")).status, 409);

		await request(`/merchants/${mart}/restore`, "POST");
		assert.equal(await reviewed("Mart"), true);
		assert.equal(await reviewed("Mart Polska Sp. z o.o."), false);
	});

	it("puts a detached name up for review as a new merchant", async () => {
		const store = await idOf("ZABKA Z1234");
		const merchant = (await listMerchants()).find((candidate: any) => candidate.id === store);
		const [other] = merchant.otherNames;
		await request(`/merchants/${store}/detach`, "POST", { key: other.key });

		assert.equal(await reviewed(other.name), false);
	});
});

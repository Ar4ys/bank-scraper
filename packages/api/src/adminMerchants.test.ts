import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { createTestDb } from "./db/testDb.ts";
import { rawCardTransaction, rawTransferSend } from "./processing/fixtures.ts";

const { cleanup } = await createTestDb();
const { ingestRawTransactions } = await import("./ingest.ts");
const { app } = await import("./app.ts");
after(cleanup);

const cardPayment = (bankId: string, merchantName: string) => ({
	bankId,
	data: rawCardTransaction({ operation_id: bankId, details: { merchant_name: merchantName } }),
});

const ingest = (transactions: Parameters<typeof ingestRawTransactions>[0]["transactions"]) =>
	ingestRawTransactions({ sourceAccount: "PL00", transactions });

await ingest([
	cardPayment("mcd-1", "McDonald's"),
	cardPayment("mcd-2", "PAYPAL *MCD"),
	cardPayment("lidl-1", "Lidl"),
	{ bankId: "transfer-1", data: rawTransferSend() },
]);

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
const merchantByName = async (name: string) =>
	(await listMerchants()).find((merchant: any) => merchant.name === name);

/** `[bankId, merchant]` of the card payments */
const paymentMerchants = async () =>
	(await request("/transactions")).body.items
		.filter((item: any) => item.bankId !== "transfer-1")
		.map((item: any) => [item.bankId, item.merchant])
		.toSorted();

const versionCauses = async (bankId: string) => {
	const { items } = (await request("/transactions")).body;
	const { id } = items.find((item: any) => item.bankId === bankId);

	return (await request(`/transactions/${id}`)).body.versions.map((version: any) => [
		version.cause,
		version.data.merchant,
	]);
};

// The tests build on each other: rename, merge, detach, delete, restore
describe("admin merchants API", () => {
	it("lists the merchants that transactions were derived with", async () => {
		assert.deepEqual(
			(await listMerchants()).map((merchant: any) => [
				merchant.name,
				merchant.transactionCount,
				merchant.otherNames,
				merchant.deletedAt,
			]),
			[
				["Lidl", 1, [], null],
				["McDonald's", 1, [], null],
				["PAYPAL *MCD", 1, [], null],
				["SOMEONE WHO RECEIVED MONEY", 1, [], null],
			],
		);
	});

	it("previews a change without writing anything", async () => {
		const mcDonalds = await merchantByName("McDonald's");
		const paypal = await merchantByName("PAYPAL *MCD");
		const before = await listMerchants();

		const merge = await request(`/merchants/${paypal.id}/merge?dryRun=true`, "POST", {
			intoId: mcDonalds.id,
		});

		assert.equal(merge.status, 200);
		assert.deepEqual(
			merge.body.changes.map((change: any) => [
				change.bankId,
				change.cause,
				change.before.merchant,
				change.after.merchant,
			]),
			[["mcd-2", "merchants", "PAYPAL *MCD", "McDonald's"]],
		);

		const remove = await request(`/merchants/${mcDonalds.id}?dryRun=true`, "DELETE");

		assert.deepEqual(
			remove.body.changes.map((change: any) => [change.bankId, change.after.merchant]),
			[["mcd-1", null]],
		);

		assert.deepEqual(await listMerchants(), before);
		assert.deepEqual(await versionCauses("mcd-1"), [["raw", "McDonald's"]]);
		assert.deepEqual(await versionCauses("mcd-2"), [["raw", "PAYPAL *MCD"]]);
	});

	it("renames a merchant in its transactions and records that in their history", async () => {
		const lidl = await merchantByName("Lidl");
		const { status, body } = await request(`/merchants/${lidl.id}`, "PATCH", {
			name: " Lidl Polska ",
		});

		assert.deepEqual([status, body.changes.length], [200, 1]);
		assert.deepEqual(await versionCauses("lidl-1"), [
			["raw", "Lidl"],
			["merchants", "Lidl Polska"],
		]);

		const renamed = await merchantByName("Lidl Polska");
		assert.deepEqual([renamed.id, renamed.otherNames], [lidl.id, [{ key: "lidl", name: "Lidl" }]]);
	});

	it("keeps resolving the previous name to the renamed merchant", async () => {
		await ingest([cardPayment("lidl-2", "LIDL")]);

		assert.deepEqual(
			(await paymentMerchants()).filter(([bankId]: [string]) => bankId.startsWith("lidl")),
			[
				["lidl-1", "Lidl Polska"],
				["lidl-2", "Lidl Polska"],
			],
		);
	});

	it("rejects a rename to a name of another merchant", async () => {
		const lidl = await merchantByName("Lidl Polska");
		const { status, body } = await request(`/merchants/${lidl.id}`, "PATCH", {
			name: "mcdonald's",
		});

		assert.equal(status, 409);
		assert.match(body.message, /already a name of the merchant "McDonald's"/);
		assert.ok(await merchantByName("Lidl Polska"));
	});

	it("rejects a rename it cannot use", async () => {
		const lidl = await merchantByName("Lidl Polska");

		assert.equal((await request(`/merchants/${lidl.id}`, "PATCH", { name: " " })).status, 400);
		assert.equal((await request("/merchants/nope", "PATCH", { name: "Nope" })).status, 404);
	});

	it("merges a merchant into another one", async () => {
		const mcDonalds = await merchantByName("McDonald's");
		const paypal = await merchantByName("PAYPAL *MCD");

		const { status, body } = await request(`/merchants/${paypal.id}/merge`, "POST", {
			intoId: mcDonalds.id,
		});

		assert.deepEqual([status, body.changes.length], [200, 1]);
		assert.equal(await merchantByName("PAYPAL *MCD"), undefined);

		const merged = await merchantByName("McDonald's");
		assert.deepEqual(
			[merged.transactionCount, merged.otherNames],
			[2, [{ key: "paypal *mcd", name: "PAYPAL *MCD" }]],
		);
		assert.deepEqual(await versionCauses("mcd-2"), [
			["raw", "PAYPAL *MCD"],
			["merchants", "McDonald's"],
		]);
	});

	it("gives a later transaction with a merged name the merchant it was merged into", async () => {
		await ingest([cardPayment("mcd-3", "PAYPAL *MCD")]);

		assert.deepEqual(
			(await paymentMerchants()).filter(([bankId]: [string]) => bankId.startsWith("mcd")),
			[
				["mcd-1", "McDonald's"],
				["mcd-2", "McDonald's"],
				["mcd-3", "McDonald's"],
			],
		);
		assert.deepEqual(await versionCauses("mcd-3"), [["raw", "McDonald's"]]);
	});

	it("rejects a merge it cannot do", async () => {
		const mcDonalds = await merchantByName("McDonald's");
		const merge = (id: string, intoId: string) =>
			request(`/merchants/${id}/merge`, "POST", { intoId });

		assert.equal((await merge(mcDonalds.id, mcDonalds.id)).status, 400);
		assert.equal((await merge(mcDonalds.id, "nope")).status, 404);
	});

	it("lists the transactions of a merchant", async () => {
		const mcDonalds = await merchantByName("McDonald's");
		const { body } = await request(`/transactions?merchantId=${mcDonalds.id}`);

		assert.deepEqual(body.items.map((item: any) => item.bankId).toSorted(), [
			"mcd-1",
			"mcd-2",
			"mcd-3",
		]);
	});

	it("detaches a merged name into a merchant of its own", async () => {
		const mcDonalds = await merchantByName("McDonald's");
		const detach = (key: string) => request(`/merchants/${mcDonalds.id}/detach`, "POST", { key });

		assert.equal((await detach("mcdonald's")).status, 400);
		assert.equal((await detach("lidl")).status, 404);

		const { status, body } = await detach("paypal *mcd");
		assert.deepEqual([status, body.changes.length], [200, 2]);

		const detached = await merchantByName("PAYPAL *MCD");
		assert.deepEqual([detached.id, detached.transactionCount], [body.merchantId, 2]);
		assert.deepEqual((await merchantByName("McDonald's")).otherNames, []);
	});

	it("deletes a merchant: its transactions lose it, now and later", async () => {
		const paypal = await merchantByName("PAYPAL *MCD");
		const { status, body } = await request(`/merchants/${paypal.id}`, "DELETE");

		assert.deepEqual([status, body.changes.length], [200, 2]);

		await ingest([cardPayment("mcd-4", "PAYPAL *MCD")]);

		assert.deepEqual(
			(await paymentMerchants()).filter(([bankId]: [string]) => bankId.startsWith("mcd")),
			[
				["mcd-1", "McDonald's"],
				["mcd-2", null],
				["mcd-3", null],
				["mcd-4", null],
			],
		);

		const deleted = await merchantByName("PAYPAL *MCD");
		assert.equal(deleted.transactionCount, 0);
		assert.ok(deleted.deletedAt);
	});

	it("does not merge with a deleted merchant", async () => {
		const mcDonalds = await merchantByName("McDonald's");
		const paypal = await merchantByName("PAYPAL *MCD");

		const { status } = await request(`/merchants/${paypal.id}/merge`, "POST", {
			intoId: mcDonalds.id,
		});

		assert.equal(status, 409);
	});

	it("restores a deleted merchant with its transactions", async () => {
		const paypal = await merchantByName("PAYPAL *MCD");
		const { status, body } = await request(`/merchants/${paypal.id}/restore`, "POST");

		assert.deepEqual([status, body.changes.length], [200, 3]);

		const restored = await merchantByName("PAYPAL *MCD");
		assert.deepEqual([restored.deletedAt, restored.transactionCount], [null, 3]);
	});
});

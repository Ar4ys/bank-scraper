import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { createTestDb } from "./db/testDb.ts";
import { rawCardTransaction } from "./processing/fixtures.ts";

const { cleanup } = await createTestDb();
const { ingestRawTransactions } = await import("./ingest.ts");
const { app } = await import("./app.ts");
after(cleanup);

let nextId = 0;
const payment = (address: string, date: string) => {
	const bankId = `p-${nextId++}`;
	return {
		bankId,
		data: rawCardTransaction({ operation_id: bankId, details: { address, order_date: date } }),
	};
};

const ingest = (payments: Array<ReturnType<typeof payment>>) =>
	ingestRawTransactions({ accountNumber: "PL00", transactions: payments });

await ingest([
	payment("KIOSK 1", "2024-01-01"),
	payment("KIOSK 2", "2024-02-01"),
	payment("KIOSK 3", "2024-03-01"),
	payment("TRAVEL CAFE", "2025-06-01"),
	payment("TRAVEL CAFE", "2025-06-02"),
	payment("TRAVEL CAFE", "2025-06-03"),
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

/** `[key, ignored forever?]` of every place, `null` when it is not ignored */
const states = async () =>
	(await request("/merchant-map/places")).body
		.map((place: any) => [place.key, place.ignored && place.ignored.forever])
		.toSorted();

const ignore = (key: string, forever: boolean) =>
	request("/merchant-map/places/ignore", "POST", { key, forever });

const farFuture = "2099-01-01";

// The tests build on each other: ignore, new payments, ignore forever, restore
describe("ignoring places without a merchant", () => {
	it("lists places as not ignored at first", async () => {
		assert.deepEqual(await states(), [
			["kiosk", null],
			["travel cafe", null],
		]);
	});

	it("ignores a place for now and forever", async () => {
		assert.equal((await ignore("kiosk", false)).status, 200);
		assert.equal((await ignore("travel cafe", true)).status, 200);

		assert.deepEqual(await states(), [
			["kiosk", false],
			["travel cafe", true],
		]);
	});

	it("keeps both ignored when a payment dated before the ignore arrives", async () => {
		await ingest([payment("KIOSK 4", "2024-04-01"), payment("TRAVEL CAFE", "2025-06-04")]);

		assert.deepEqual(await states(), [
			["kiosk", false],
			["travel cafe", true],
		]);
	});

	it("brings back a place ignored for now once a payment dated after the ignore arrives", async () => {
		await ingest([payment("KIOSK 5", farFuture), payment("TRAVEL CAFE", farFuture)]);

		assert.deepEqual(await states(), [
			["kiosk", null],
			["travel cafe", true],
		]);
	});

	it("restores a place ignored forever", async () => {
		assert.equal(
			(await request("/merchant-map/places/restore", "POST", { key: "travel cafe" })).status,
			200,
		);

		assert.deepEqual(await states(), [
			["kiosk", null],
			["travel cafe", null],
		]);
	});

	it("ignores a place for now again from its newest payment on", async () => {
		await ignore("kiosk", false);
		assert.deepEqual((await states())[0], ["kiosk", false]);
	});

	it("rejects an empty key", async () => {
		assert.equal((await ignore("", false)).status, 400);
	});
});

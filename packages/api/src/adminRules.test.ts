import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { createTestDb } from "./db/testDb.ts";
import { rawCardTransaction, rawTransferSend } from "./processing/fixtures.ts";

const { cleanup } = await createTestDb();
const { ingestRawTransactions } = await import("./ingest.ts");
const { app } = await import("./app.ts");
after(cleanup);

await ingestRawTransactions({
	sourceAccount: "PL00",
	transactions: [
		{ bankId: "card-1", data: rawCardTransaction() },
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

const boltRule = {
	name: "Bolt",
	enabled: true,
	txTypes: ["cardTransaction"],
	conditions: [{ path: "details.title", operator: "regex", pattern: "^BOLT\\.EU/P/(\\d+)" }],
	set: { merchant: "Bolt", description: "Bolt ride {match.1}" },
};

const merchants = async () =>
	(await request("/transactions")).body.items.map((item: any) => [item.bankId, item.merchant]);

// The tests build on each other: draft, preview, apply, change
describe("admin rules API", () => {
	it("starts without rules or revisions", async () => {
		const { body } = await request("/rules");

		assert.deepEqual(
			[body.rules, body.appliedRevisionId, body.hasUnappliedChanges],
			[[], null, false],
		);
		assert.ok(body.txTypes.includes("cardTransaction"));
		assert.ok(
			body.fieldsByTxType.cardTransaction.some((field: any) => field.path === "details.title"),
		);
	});

	it("rejects rules it cannot use", async () => {
		const invalid = (rule: object) =>
			request("/rules", "PUT", { rules: [{ ...boltRule, ...rule }] });

		assert.equal(
			(await invalid({ conditions: [{ path: "title", operator: "regex", pattern: "(" }] })).status,
			400,
		);
		assert.equal((await invalid({ txTypes: ["nope"] })).status, 400);
		assert.equal((await invalid({ set: { nope: "x" } })).status, 400);
		assert.equal((await invalid({ name: " " })).status, 400);
	});

	it("previews unsaved rules without writing anything", async () => {
		const { status, body } = await request("/rules/preview", "POST", { rules: [boltRule] });

		assert.equal(status, 200);
		assert.deepEqual(
			body.changes.map((change: any) => [
				change.bankId,
				change.cause,
				change.after.merchant,
				change.after.description,
			]),
			[["card-1", "rules", "Bolt", "Bolt ride 20261003"]],
		);
		assert.equal(body.unchanged, 1);
		assert.deepEqual(await merchants(), [
			["card-1", null],
			["transfer-1", "Jan Kowalski"],
		]);
	});

	it("limits a preview to one bank transaction", async () => {
		const accountId = (await request("/accounts")).body[0].id;
		const { body } = await request("/rules/preview", "POST", {
			rules: [boltRule],
			only: { accountId, bankId: "transfer-1" },
		});

		assert.deepEqual([body.changes.length, body.unchanged], [0, 1]);
	});

	it("saves the working set in list order, which stays unapplied", async () => {
		const other = { ...boltRule, name: "Other", enabled: false };
		const saved = await request("/rules", "PUT", { rules: [boltRule, other] });

		assert.deepEqual(
			saved.body.rules.map((rule: any) => [rule.name, rule.priority]),
			[
				["Bolt", 0],
				["Other", 1],
			],
		);

		const { body } = await request("/rules");
		assert.deepEqual(body.rules, saved.body.rules);
		assert.deepEqual([body.appliedRevisionId, body.hasUnappliedChanges], [null, true]);
		assert.deepEqual((await merchants())[0], ["card-1", null]);
	});

	it("applies the working set as a revision and reprocesses", async () => {
		const { status, body } = await request("/rules/apply", "POST");

		assert.equal(status, 200);
		assert.equal(body.changes.length, 1);
		assert.deepEqual((await merchants())[0], ["card-1", "Bolt"]);

		const current = (await request("/rules")).body;
		assert.deepEqual(
			[current.appliedRevisionId, current.hasUnappliedChanges],
			[body.revisionId, false],
		);

		const revisions = (await request("/rules/revisions")).body;
		assert.deepEqual(
			revisions.map((revision: any) => [revision.id, revision.ruleCount]),
			[[body.revisionId, 2]],
		);
		assert.equal((await request(`/rules/revisions/${body.revisionId}`)).body.rules[0].name, "Bolt");
		assert.equal((await request("/rules/revisions/nope")).status, 404);
	});

	it("refuses to apply rules that produce invalid values, and keeps everything as it was", async () => {
		const { rules } = (await request("/rules")).body;
		await request("/rules", "PUT", { rules: [{ ...rules[0], set: { date: "{details.title}" } }] });

		const preview = await request("/rules/preview", "POST", {
			rules: [{ ...rules[0], set: { date: "{details.title}" } }],
		});
		assert.deepEqual(
			preview.body.errors.map((failure: any) => [failure.bankId, failure.error.stage]),
			[["card-1", "rules"]],
		);

		const applied = await request("/rules/apply", "POST");
		assert.equal(applied.status, 400);
		assert.equal(applied.body.errors.length, 1);

		assert.equal((await request("/rules/revisions")).body.length, 1);
		assert.deepEqual((await merchants())[0], ["card-1", "Bolt"]);
		assert.equal((await request("/raw-transactions?status=error")).body.total, 0);
	});

	it("keeps the id of an existing rule and records a rule change in the history", async () => {
		const { rules } = (await request("/rules")).body;
		const saved = await request("/rules", "PUT", {
			rules: [{ ...rules[0], set: { merchant: "Bolt Taxi" } }],
		});
		assert.equal(saved.body.rules[0].id, rules[0].id);

		await request("/rules/apply", "POST");

		const list = await request("/transactions?search=card-1");
		const { body } = await request(`/transactions/${list.body.items[0].id}`);
		assert.deepEqual(
			body.versions.map((version: any) => [
				version.cause,
				version.data.merchant,
				version.fieldSources.merchant,
			]),
			[
				["raw", null, "default"],
				["rules", "Bolt", rules[0].id],
				["rules", "Bolt Taxi", rules[0].id],
			],
		);
	});
});

import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { after, beforeEach, describe, it } from "node:test";

import { createTestDb } from "./db/testDb.ts";

const apiKey = "test-sure-key";

const category = (id: string, name: string, parentName?: string) => ({
	id,
	name,
	color: "#6172F3",
	icon: "shapes",
	parent: parentName ? { id: `parent-of-${id}`, name: parentName } : null,
	subcategories_count: 0,
	created_at: "2026-11-14T00:00:00Z",
	updated_at: "2026-11-14T00:00:00Z",
});

const pages = [
	[category("1", "Food"), category("2", "Groceries", "Food")],
	[category("3", "Transport")],
];

/** What the fake Sure answers next, and the requests it got */
let answer: "pages" | "unauthorized" | "malformed" = "pages";
let requests: IncomingMessage[] = [];
beforeEach(() => {
	answer = "pages";
	requests = [];
});

const sure = createServer((request, response) => {
	requests.push(request);
	const url = new URL(request.url ?? "/", "http://localhost");

	if (answer === "unauthorized") {
		response.writeHead(401, { "Content-Type": "application/json" });
		response.end(JSON.stringify({ error: "unauthorized" }));
		return;
	}
	if (answer === "malformed") {
		response.writeHead(200, { "Content-Type": "application/json" });
		response.end(JSON.stringify({ categories: "none" }));
		return;
	}

	const page = Number(url.searchParams.get("page"));
	response.writeHead(200, { "Content-Type": "application/json" });
	response.end(
		JSON.stringify({
			categories: pages[page - 1] ?? [],
			pagination: { page, per_page: 100, total_count: 3, total_pages: pages.length },
		}),
	);
});
await new Promise<void>((resolve) => sure.listen(0, "127.0.0.1", resolve));
const address = sure.address();
assert.ok(address !== null && typeof address === "object");
const { port } = address;

process.env.SURE_API_URL = `http://127.0.0.1:${port}/`;
process.env.SURE_API_KEY = apiKey;
const { cleanup } = await createTestDb();
const { listSureCategories } = await import("./sure.ts");
const { app } = await import("./app.ts");
after(() => {
	cleanup();
	sure.close();
});

const getCategories = async () => {
	const response = await app.request("/api/admin/sure/categories");
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	return { status: response.status, body: (await response.json()) as any };
};

describe("listSureCategories", () => {
	it("reads every page with the API key", async () => {
		assert.deepEqual(await listSureCategories(), [
			{ id: "1", name: "Food", color: "#6172F3", parentName: null },
			{ id: "2", name: "Groceries", color: "#6172F3", parentName: "Food" },
			{ id: "3", name: "Transport", color: "#6172F3", parentName: null },
		]);

		assert.deepEqual(
			requests.map((request) => request.url),
			["/api/v1/categories?page=1&per_page=100", "/api/v1/categories?page=2&per_page=100"],
		);
		assert.ok(requests.every((request) => request.headers["x-api-key"] === apiKey));
	});

	it("throws when Sure refuses the key", async () => {
		answer = "unauthorized";
		await assert.rejects(listSureCategories(), /Sure answered 401/);
	});

	it("throws on an unexpected answer", async () => {
		answer = "malformed";
		await assert.rejects(listSureCategories(), /unexpected list of categories/);
	});
});

describe("GET /api/admin/sure/categories", () => {
	it("returns the categories", async () => {
		const { status, body } = await getCategories();

		assert.equal(status, 200);
		assert.equal(body.enabled, true);
		assert.deepEqual(
			body.categories.map((item: any) => item.name),
			["Food", "Groceries", "Transport"],
		);
	});

	it("answers 502 when Sure fails", async () => {
		answer = "unauthorized";
		const { status, body } = await getCategories();

		assert.equal(status, 502);
		assert.match(body.message, /Sure answered 401/);
	});
});

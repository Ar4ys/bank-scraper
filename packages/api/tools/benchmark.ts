// Benchmark of reprocessing every transaction, the work behind every merchant map, merchant and
// rule change. Prints timings and counts only.
//
// Usage, from packages/api (in the container: /app/packages/api):
//   node tools/benchmark.ts                    3400 synthetic payments in a temp database
//   node tools/benchmark.ts <backup file>      a copy of that backup (make it with tools/backup.ts);
//                                              the file itself is never opened for writing
//
// Everything runs against a temp database that is deleted at the end.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const backupPath = process.argv[2];
const steps = backupPath ? 18 : 19;
const startedAt = performance.now();
let step = 0;

const elapsed = () => `${((performance.now() - startedAt) / 1000).toFixed(0)} s`;

async function time(label: string, runs: number, fn: () => unknown) {
	step++;
	process.stdout.write(`[${step}/${steps}, ${elapsed()}] ${label} ...\r`);
	await fn(); // warm-up
	const started = performance.now();
	for (let i = 0; i < runs; i++) await fn();
	const ms = (performance.now() - started) / runs;
	console.log(
		`[${step}/${steps}, ${elapsed()}] ${label.padEnd(62)} ${ms.toFixed(1).padStart(9)} ms`,
	);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bank-scraper-benchmark-"));
process.on("exit", () => fs.rmSync(tempDir, { recursive: true, force: true }));

if (backupPath) {
	const copy = path.join(tempDir, "copy.db");
	fs.copyFileSync(backupPath, copy, fs.constants.COPYFILE_EXCL);
	process.env.SQLITE_DB_PATH = copy;
	process.env.INGEST_API_KEY = "benchmark";
	process.env.LUNCHFLOW_API_KEY = "benchmark";
} else {
	const { createTestDb } = await import("../src/db/testDb.ts");
	await createTestDb();
}

const { db, tables, initSQLite } = await import("../src/db/db.ts");
await initSQLite();
const { app } = await import("../src/app.ts");
const { rawCardTransaction } = await import("../src/processing/fixtures.ts");
const { listBankTransactionKeys, loadMerchantMap, processBankTransactions, getLatestRuleRevision } =
	await import("../src/processing/process.ts");
const { loadMerchantDirectory } = await import("../src/processing/merchants.ts");
const { deriveTransaction } = await import("../src/processing/derive.ts");
const { baseTxSchema, ipkoTransactionSchema, ipkoTransactionToJson } =
	await import("../src/ipkoSchemas.ts");
const { findMapEntry } = await import("../src/processing/merchantMap.ts");
const { applyRules } = await import("../src/processing/rules.ts");
const { deriveDefaults } = await import("../src/processing/defaults.ts");
const { ingestRawTransactions } = await import("../src/ingest.ts");
const { and, desc, eq } = await import("drizzle-orm");

const request = (requestPath: string, method: string, body?: unknown) =>
	app.request(`/api/admin${requestPath}`, {
		method,
		headers: body === undefined ? undefined : { "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});

async function seed() {
	const total = 3400;
	const shops = 400;
	const seedStarted = performance.now();

	for (let start = 0; start < total; start += 200) {
		await ingestRawTransactions({
			accountNumber: "PL00",
			transactions: Array.from({ length: Math.min(200, total - start) }, (_, i) => {
				const n = start + i;
				const shop = n % shops;
				return {
					bankId: String(n),
					data: rawCardTransaction({
						operation_id: String(n),
						details: {
							address: `SHOP${shop} STORE ${n % 7}`,
							...(shop % 3 === 0 ? { merchant_name: `Bank Shop ${shop}` } : {}),
						},
					}),
				};
			}),
		});

		const done = Math.min(start + 200, total);
		const seconds = (performance.now() - seedStarted) / 1000;
		const rate = done / seconds;
		process.stdout.write(
			`Seeding ${done}/${total} payments, ${rate.toFixed(0)}/s, ETA ${((total - done) / rate).toFixed(0)} s   \r`,
		);
	}
	console.log();

	const payments = ["cardTransaction", "mobileTransaction"];
	await request("/rules", "PUT", {
		rules: [
			{
				name: "Regex",
				enabled: true,
				txTypes: payments,
				conditions: [
					{
						path: "details.address",
						operator: "regex",
						pattern: `(${Array.from({ length: 63 }, (_, i) => `(?:NOPE${i})`).join("|")})`,
					},
				],
				set: { merchant: "{match.1}" },
			},
			{
				name: "Uber",
				enabled: true,
				txTypes: payments,
				conditions: [{ path: "details.address", operator: "regex", pattern: "UBER\\D+\\*EATS" }],
				set: { merchant: "Uber Eats" },
			},
		],
	});
	await request("/rules/apply", "POST", {});

	for (let i = 0; i < 135; i++) {
		db.insert(tables.merchantMapEntries)
			.values({
				field: "address",
				text: `SHOP${i + 1} `,
				matchKey: `shop${i + 1} `,
				merchant: `Shop ${i + 1}`,
			})
			.run();
	}
	process.stdout.write("Processing the seeded payments...\r");
	processBankTransactions(listBankTransactionKeys());
	console.log("Seeded.                            ");
}

if (!backupPath) await seed();

console.log(
	[
		`\nNode ${process.version}, ${os.cpus()[0]?.model ?? "unknown CPU"}, ${os.cpus().length} cores`,
		`Data: ${backupPath ? "copy of a backup" : "synthetic"}`,
		`Transactions: ${await db.$count(tables.transactions)}, raw rows: ${await db.$count(tables.rawTransactions)}, versions: ${await db.$count(tables.transactionVersions)}`,
		`Merchants: ${await db.$count(tables.merchants)}, map entries: ${await db.$count(tables.merchantMapEntries)}, rules: ${getLatestRuleRevision().rules.length}\n`,
	].join("\n"),
);

console.log("End to end (dry runs: nothing is written)");
await time("POST /merchant-map?dryRun=true (Name it preview)", 3, async () => {
	const response = await request("/merchant-map?dryRun=true", "POST", {
		field: "address",
		text: "BENCHMARK TEXT THAT MATCHES NOTHING",
		merchant: "Benchmark",
	});
	if (!response.ok) throw new Error(`Preview failed: ${response.status} ${await response.text()}`);
	await response.json();
});
if (!backupPath) {
	let applied = 0;
	await time("POST /merchant-map (Name it, applied; synthetic data only)", 3, async () => {
		const response = await request("/merchant-map", "POST", {
			field: "address",
			text: `SHOP${300 + applied++} `,
			merchant: "Applied shop",
		});
		await response.json();
	});
}
await time("GET /merchant-map/places", 3, async () =>
	(await request("/merchant-map/places", "GET")).json(),
);
await time("GET /merchant-map", 3, async () => (await request("/merchant-map", "GET")).json());

console.log("\nPhases of processing every transaction");
const keys = listBankTransactionKeys();
await time("processBankTransactions(all, dryRun)", 3, () =>
	processBankTransactions(keys, { dryRun: true }),
);
await time("listBankTransactionKeys", 3, () => listBankTransactionKeys());
await time("loadMerchantMap + loadMerchantDirectory", 3, () => {
	loadMerchantMap();
	loadMerchantDirectory();
});

const { rawTransactions, transactions, transactionVersions } = tables;
await time(`3 lookups per transaction through drizzle × ${keys.length}`, 3, () => {
	for (const key of keys) {
		db.select()
			.from(rawTransactions)
			.where(
				and(eq(rawTransactions.accountId, key.accountId), eq(rawTransactions.bankId, key.bankId)),
			)
			.orderBy(desc(rawTransactions.id))
			.limit(1)
			.get();
		const tx = db
			.select()
			.from(transactions)
			.where(and(eq(transactions.accountId, key.accountId), eq(transactions.bankId, key.bankId)))
			.get();
		if (tx) {
			db.select()
				.from(transactionVersions)
				.where(eq(transactionVersions.transactionId, tx.id))
				.orderBy(desc(transactionVersions.id))
				.limit(1)
				.get();
		}
	}
});

const raws = keys.map(
	(key) =>
		db
			.select()
			.from(rawTransactions)
			.where(
				and(eq(rawTransactions.accountId, key.accountId), eq(rawTransactions.bankId, key.bankId)),
			)
			.orderBy(desc(rawTransactions.id))
			.limit(1)
			.get()?.data,
);
const rules = getLatestRuleRevision().rules;
const map = loadMerchantMap();
const parsed = raws.flatMap((data) => {
	const result = ipkoTransactionSchema.safeParse(data);
	return result.success ? [result.data] : [];
});
const jsons = parsed.map((tx) => ipkoTransactionToJson(tx));

await time("deriveTransaction × all (the four rows below together)", 3, () => {
	for (const data of raws) deriveTransaction(data, rules, map);
});
await time("  baseTxSchema.safeParse + ipkoTransactionSchema.safeParse × all", 3, () => {
	for (const data of raws) {
		baseTxSchema.safeParse(data);
		ipkoTransactionSchema.safeParse(data);
	}
});
await time("  ipkoTransactionToJson × all", 3, () => {
	for (const tx of parsed) ipkoTransactionToJson(tx);
});
await time(`  findMapEntry × all (${map.length} entries)`, 3, () => {
	for (const tx of parsed) findMapEntry(tx, map);
});
await time(`  deriveDefaults + applyRules × all (${rules.length} rules)`, 3, () => {
	for (const [i, tx] of parsed.entries()) applyRules(deriveDefaults(tx), jsons[i], rules);
});

console.log("\nAlternatives for the lookups");
await time("3 bulk queries: all raw rows, transactions, versions", 3, () => {
	db.select().from(rawTransactions).all();
	db.select().from(transactions).all();
	db.select().from(transactionVersions).all();
});
const client = db.$client;
const rawStmt = client.prepare(
	"SELECT * FROM raw_transactions WHERE account_id = ? AND bank_id = ? ORDER BY id DESC LIMIT 1",
);
const txStmt = client.prepare("SELECT * FROM transactions WHERE account_id = ? AND bank_id = ?");
const versionStmt = client.prepare(
	"SELECT * FROM transaction_versions WHERE transaction_id = ? ORDER BY id DESC LIMIT 1",
);
await time(`same 3 lookups as prepared statements × ${keys.length}`, 3, () => {
	for (const key of keys) {
		rawStmt.get(key.accountId, key.bankId);
		const tx = txStmt.get(key.accountId, key.bankId);
		if (tx && typeof tx.id === "string") versionStmt.get(tx.id);
	}
});

const { sql } = await import("drizzle-orm");
const rawQuery = db
	.select()
	.from(rawTransactions)
	.where(
		and(
			eq(rawTransactions.accountId, sql.placeholder("accountId")),
			eq(rawTransactions.bankId, sql.placeholder("bankId")),
		),
	)
	.orderBy(desc(rawTransactions.id))
	.limit(1)
	.prepare();
const txQuery = db
	.select()
	.from(transactions)
	.where(
		and(
			eq(transactions.accountId, sql.placeholder("accountId")),
			eq(transactions.bankId, sql.placeholder("bankId")),
		),
	)
	.prepare();
const versionQuery = db
	.select()
	.from(transactionVersions)
	.where(eq(transactionVersions.transactionId, sql.placeholder("transactionId")))
	.orderBy(desc(transactionVersions.id))
	.limit(1)
	.prepare();
await time(`same 3 lookups as drizzle prepared queries × ${keys.length}`, 3, () => {
	for (const key of keys) {
		rawQuery.get(key);
		const tx = txQuery.get(key);
		if (tx) versionQuery.get({ transactionId: tx.id });
	}
});

const { inArray } = await import("drizzle-orm");

/** What processing needs per key, read for a batch of keys at a time */
function loadInBatches(batchSize: number) {
	let found = 0;

	for (let start = 0; start < keys.length; start += batchSize) {
		const batch = keys.slice(start, start + batchSize);
		const bankIdsByAccount = Map.groupBy(batch, (key) => key.accountId);

		const latestRaw = new Map<string, { id: string }>();
		const transactionByKey = new Map<string, { id: string }>();

		for (const [accountId, accountKeys] of bankIdsByAccount) {
			const bankIds = accountKeys.map((key) => key.bankId);

			for (const raw of db
				.select()
				.from(rawTransactions)
				.where(
					and(eq(rawTransactions.accountId, accountId), inArray(rawTransactions.bankId, bankIds)),
				)
				.all()) {
				const key = `${raw.accountId}\n${raw.bankId}`;
				const current = latestRaw.get(key);
				if (!current || raw.id > current.id) latestRaw.set(key, raw);
			}

			for (const tx of db
				.select()
				.from(transactions)
				.where(and(eq(transactions.accountId, accountId), inArray(transactions.bankId, bankIds)))
				.all()) {
				transactionByKey.set(`${tx.accountId}\n${tx.bankId}`, tx);
			}
		}

		const latestVersion = new Map<string, { id: string }>();
		const transactionIds = [...transactionByKey.values()].map((tx) => tx.id);
		for (const version of db
			.select()
			.from(transactionVersions)
			.where(inArray(transactionVersions.transactionId, transactionIds))
			.all()) {
			const current = latestVersion.get(version.transactionId);
			if (!current || version.id > current.id) latestVersion.set(version.transactionId, version);
		}

		found += latestRaw.size + transactionByKey.size + latestVersion.size;
	}

	return found;
}

for (const batchSize of [100, 500, 2000]) {
	await time(`same 3 lookups in batches of ${batchSize} (3 queries per batch)`, 3, () =>
		loadInBatches(batchSize),
	);
}

client.close();
console.log(`\nDone in ${elapsed()}. The temp database is deleted.`);

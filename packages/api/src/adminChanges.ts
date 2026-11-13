import { zValidator } from "@hono/zod-validator";
import { TransactionRollbackError } from "drizzle-orm";
import { type Context } from "hono";
import { z } from "zod";

import { reportJson } from "./adminRules.ts";
import { db } from "./db/db.ts";
import { type TransactionVersionCause } from "./db/schema.ts";
import { listBankTransactionKeys, processBankTransactions } from "./processing/process.ts";

export const idParam = zValidator("param", z.object({ id: z.string() }));

export const dryRunQuery = zValidator(
	"query",
	z.object({
		/** Report what would change without writing anything */
		dryRun: z.stringbool().default(false),
	}),
);

export type Rejection = { rejected: { status: 400 | 404 | 409; message: string } };

export const reject = (status: Rejection["rejected"]["status"], message: string): Rejection => ({
	rejected: { status, message },
});

/**
 * Runs a change of merchants or of the merchant map and derives every transaction again, so that
 * they get their new merchant and a version that records it with `cause`. Returns what `change`
 * returned together with the report of that processing, or the rejection of `change`, which must
 * not have written anything then.
 *
 * With `dryRun` all of it is rolled back, and the report says what would change.
 */
export function changeAndReprocess<T extends object>(
	dryRun: boolean,
	cause: typeof TransactionVersionCause.Merchants | typeof TransactionVersionCause.MerchantMap,
	change: () => Rejection | T,
) {
	const outcome: { value?: Rejection | (T & ReturnType<typeof reportJson>) } = {};

	try {
		db.transaction((tx) => {
			const changed = change();

			if ("rejected" in changed) {
				outcome.value = changed;
				return;
			}

			const report = processBankTransactions(listBankTransactionKeys(), { cause });
			outcome.value = { ...changed, ...reportJson(report) };

			// A dry run that only pretended could report something else than the real run does
			if (dryRun) tx.rollback();
		});
	} catch (error) {
		if (!(error instanceof TransactionRollbackError)) throw error;
	}

	if (!outcome.value) throw new Error("The change has no outcome");

	return outcome.value;
}

export const respond = <T extends object>(c: Context, result: Rejection | T) =>
	"rejected" in result
		? c.json({ message: result.rejected.message }, result.rejected.status)
		: c.json(result, 200);

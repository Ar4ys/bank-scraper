import { defineRelations } from "drizzle-orm";

import * as schema from "./schema.ts";

export const relations = defineRelations({
	accounts: schema.accounts,
	rawTransactions: schema.rawTransactions,
	merchants: schema.merchants,
	merchantNames: schema.merchantNames,
	transactions: schema.transactions,
	transactionVersions: schema.transactionVersions,
	rules: schema.rules,
	ruleRevisions: schema.ruleRevisions,
});

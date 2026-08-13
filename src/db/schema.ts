import { sql } from "drizzle-orm";
import * as pg from "drizzle-orm/pg-core";

export const rawTransactions = pg.snakeCase.table(
	"raw_transactions",
	{
		id: pg
			.uuid()
			.primaryKey()
			.default(sql`uuidv7()`),
		bankId: pg.text().notNull(),
		data: pg.json().notNull(),
	},
	(table) => [pg.index().on(table.bankId)],
);

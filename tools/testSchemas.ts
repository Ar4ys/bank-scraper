import fs from "fs";
import util from "node:util";
import path from "path";

import { z } from "zod";

import {
	ipkoTransactionSchema,
	IpkoTxType,
	OperationType,
	operationSubTypes,
	type IpkoTransaction,
	baseTxSchema,
} from "../src/ipkoSchemas.ts";
import { zodPrettifyError } from "../src/zod.ts";

const getMaxLength = (object: Record<string, string> | ArrayLike<string>) =>
	Math.max(...Object.values(object).map((value) => value.length));

const maxLength = {
	id: 4,
	txType: getMaxLength(IpkoTxType),
	operationType: getMaxLength(OperationType),
	operationSubType: getMaxLength(operationSubTypes),
};

function printBaseTx(result: z.infer<typeof baseTxSchema>, custom: string, ...rest: unknown[]) {
	console.log(
		result.operation_id.padEnd(maxLength.id),
		"|",
		custom.padEnd(maxLength.txType),
		"|",
		result.operation_type.padEnd(maxLength.operationType),
		"|",
		result.operation_kind.code.padEnd(maxLength.operationSubType),
		"|",
		result.title,
		...rest,
	);
}

const rawTranasctions: Array<{ operation_id: string }> = JSON.parse(
	fs.readFileSync(path.join(import.meta.dirname, "../local/main_raw_transactions.json"), "utf8"),
);

for (const rawTx of rawTranasctions) {
	const baseSchemaResult = baseTxSchema.safeParse(rawTx);

	if (baseSchemaResult.error) {
		console.log(
			rawTx.operation_id.padEnd(maxLength.id),
			"|",
			z.prettifyError(baseSchemaResult.error),
		);

		continue;
	}

	if (baseSchemaResult.data.is_hold) {
		printBaseTx(baseSchemaResult.data, "hold - skipping...");
		continue;
	}

	const result = ipkoTransactionSchema.safeParse(rawTx);

	if (result.success) {
		printBaseTx(result.data, result.data.$type);
	} else {
		printBaseTx(baseSchemaResult.data, "error", "\n", zodPrettifyError(result.error));

		// console.log(
		// 	rawTx.operation_id.padEnd(maxLength.id),
		// 	"|",
		// 	util.inspect(result.error.issues, { depth: 10 }),
		// );
	}
}

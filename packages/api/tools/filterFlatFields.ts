// Usage: node filterFlatFields.js input output

import fs from "fs";
import path from "path";

const FIELDS_TO_REMOVE: string[] = [
	"ref_fee_hint",
	"ref_map",
	"ref_operation_completed_cancel_foreign",
	"ref_operation_completed_confirmation",
	"ref_operation_completed_confirmation_en",
	"ref_operation_completed_confirmation_pl",
	"ref_operation_completed_exec_foreign",
	"ref_operation_completed_exec_normal",
	"ref_operation_completed_exec_split",
	"ref_operation_completed_exec_tax",
	"ref_operation_completed_recipient_create_normal",
	"ref_operation_completed_recipient_create_split",
	"ref_operation_completed_recipient_create_tax",
	"ref_operation_completed_repeat_foreign",
	"ref_operation_completed_repeat_normal",
	"ref_operation_completed_repeat_split",
	"ref_operation_completed_repeat_tax",
	"ebc_margin",
	"vat_account_number",
	"ending_balance",
	"coordinates",
	"recharge_operator_id",
	"avatar",
	"avatar_url",
	"google_place_id",
	"is_other_side_recipient",
	"date",
	"money",
	"details:oper_date_time",
	"details:hold_registration_date",
	"details:ending_balance",
	"details:card_number",
	"details:ref_id",
	"details:transaction_id",
];

interface Input {
	_id: string[];
	sample: Record<string, unknown>;
}

function filterFlatFields(inputPath: string, outputPath: string) {
	const input: Input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
	const shouldBeRemoved = (field: string) =>
		field.split(":").some((_, i, arr) => FIELDS_TO_REMOVE.includes(arr.slice(0, i + 1).join(":")));

	// oxlint-disable-next-line no-underscore-dangle
	input._id = input._id.filter((field) => !shouldBeRemoved(field));

	for (const field of Object.keys(input.sample)) {
		if (shouldBeRemoved(field)) {
			delete input.sample[field];
		}
	}

	fs.writeFileSync(outputPath, JSON.stringify(input, undefined, 2));
}

function main() {
	const [, , input, output = input] = process.argv;
	if (!input || !output) {
		console.error("Usage: node filterFlatFields.js input output");
		process.exit(1);
	}

	if (!fs.existsSync(input) || !fs.existsSync(output)) {
		console.error("Input or output does not exist");
		process.exit(1);
	}

	const inputIsDir = fs.lstatSync(input).isDirectory();
	const outputIsDir = fs.lstatSync(input).isDirectory();

	if (inputIsDir !== outputIsDir) {
		console.error("Both input and output should either be a file, or a directory");
		process.exit(1);
	}

	if (inputIsDir) {
		for (const file of fs.readdirSync(input)) {
			const inputPath = path.join(input, file);
			const outputPath = path.join(output, file);
			filterFlatFields(inputPath, outputPath);
			console.log(`Filtered "${inputPath}" -> ${outputPath}`);
		}
	} else {
		filterFlatFields(input, output);
		console.log(`Filtered "${input}" -> ${output}`);
	}
}

main();

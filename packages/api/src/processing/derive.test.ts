import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type Rule } from "@bank-scraper/shared";

import { deriveTransaction } from "./derive.ts";
import {
	ipkoExample,
	ipkoExamples,
	rawCardTransaction,
	rawHold,
	rawTransferSend,
} from "./fixtures.ts";

const rule = (overrides: Partial<Rule>): Rule => ({
	id: "rule",
	name: "rule",
	priority: 0,
	enabled: true,
	txTypes: null,
	conditions: [],
	set: {},
	...overrides,
});

function derive(rawData: unknown, rules: Rule[] = []) {
	const result = deriveTransaction(rawData, rules);
	assert.equal(result.status, "processed", JSON.stringify(result));
	return result;
}

describe("deriveTransaction defaults", () => {
	// [example, merchant, description, amount, date]
	const expected: Array<[string, string | null, string, string, string]> = [
		[
			"CARD_TRANSACTION/+merchant-subcategory",
			"Bolt",
			"BOLT.EU/P/2312261215, Tartu, ESTONIA",
			"-21.40",
			"2023-12-26",
		],
		[
			"CARD_TRANSACTION/+merchant",
			"Auchan",
			"AUCHAN POLSKA SP. Z  27, GDANSK, POLSKA",
			"-7.85",
			"2023-12-01",
		],
		["CARD_TRANSACTION/card_transfer", null, "PAYPAL *USER_NAME", "-64.20", "2024-06-17"],
		["CARD_TRANSACTION/default", null, "LIDL 3011, Wroclaw, POLSKA", "-57.33", "2022-02-11"],
		["MOBILE_TRANSACTION/+location", null, "LIDL 3024, POZNAN, POLSKA", "-29.90", "2022-02-13"],
		[
			"MOBILE_TRANSACTION/+merchant+location",
			"Lidl",
			"LIDL 3037, SZCZECIN, POLSKA",
			"-118.47",
			"2024-09-07",
		],
		["MOBILE_TRANSACTION/+merchant-subcategories", "Zeccer", "zeccer.pl", "-3.60", "2023-12-11"],
		["MOBILE_TRANSACTION/+merchant", "Jakdojade", "jakdojade.pl", "-5.20", "2023-10-12"],
		[
			"MOBILE_TRANSACTION/+title+tx_id+location",
			null,
			"PT, Lublin, POLSKA",
			"-36.00",
			"2024-09-04",
		],
		[
			"MOBILE_TRANSACTION/atm-title",
			null,
			"ATM, ul  Dluga 7, Katowice, POLSKA",
			"-300.00",
			"2022-05-04",
		],
		[
			"MOBILE_TRANSACTION/atm",
			null,
			"ATM, UL. KROTKA 3/5, BYDGOSZCZ, POLSKA",
			"-500.00",
			"2024-03-29",
		],
		[
			"MOBILE_TRANSACTION/blik_contactless_foreign",
			null,
			"SumUp  *CornerCafe, Manchester, WIELKA BRYTANIA",
			"-48.20",
			"2025-07-02",
		],
		["MOBILE_TRANSACTION/default", null, "orange.flex.pl/", "-1.00", "2022-02-03"],
		[
			"OTHER/-recepient_name_and_address",
			null,
			"OPŁATA MIESIĘCZNA ZA KARTĘ 123456******7890, 04.11-03.12",
			"-5.00",
			"2021-09-29",
		],
		[
			"OTHER/default",
			"PKO BP FINAT SP. Z O.O.",
			"DOŁADOWANIE TELEFONU +48 123456789 HEYAH IDENTYFIKATOR OPERACJI: 12345678",
			"-25.00",
			"2022-02-25",
		],
		[
			"OTHER/ipko_transit_ticket",
			"MOBILE-TRAFFIC-DATA SP. Z O. O.",
			"ZAKUP BILETU KOMUNIKACYJNEGO W APLIKACJI IKO",
			"-4.60",
			"2025-01-12",
		],
		[
			"REALIZED_DPW/foreign_transfer_in",
			"Someone who did the transfer",
			"SEPA Transfer from Germany to Poland (orig 150.00 EUR, rate 4.2500)",
			"637.50",
			"2025-05-31",
		],
		[
			"REALIZED_DPW/foreign_transfer_out_eur",
			"SOMEONE WHO RECEIVED MONEY",
			"Transfered from Poland to Germany (orig 20.00 EUR, rate 4.3000)",
			"-86.00",
			"2023-03-04",
		],
		[
			"REALIZED_DPW/foreign_transfer_out_pln",
			"SOMEONE WHO RECEIVED MONEY",
			"Transfered from Poland to Germany",
			"-47.00",
			"2022-05-29",
		],
		[
			"TRANSFER_NORMAL/blik_transfer",
			"SOMEONE WHO RECEIVED MONEY",
			"PEREKAZ OD: 48123456789 DO: 489*****321",
			"-1.00",
			"2021-12-15",
		],
		[
			"TRANSFER_NORMAL/blik_transfer_receive",
			"SOMEONE WHO SENT MONEY",
			"PRZELEW BLIK NA TELEFON",
			"1.00",
			"2021-12-08",
		],
		[
			"TRANSFER_NORMAL/iban_transfer",
			"SOMEONE WHO RECEIVED MONEY",
			"CUSTOM TRANSFER NAME",
			"-940.00",
			"2022-03-29",
		],
		[
			"TRANSFER_NORMAL/iban_transfer_receive+lil_different",
			"COMPANY NAME",
			"INCOMING TRANSFER FOR NAME SURNAME",
			"4100.00",
			"2023-12-24",
		],
		[
			"TRANSFER_NORMAL/iban_transfer_receive",
			"NAME OF THE COMPANY",
			"Incoming transfer for Name Surname",
			"2750.00",
			"2022-02-11",
		],
		[
			"TRANSFER_NORMAL/iban_transfer_repeat+recepient_id",
			"COMPANY NAME",
			"AUTOMATIC SCHEDULED TRANSFER",
			"-47.00",
			"2022-02-25",
		],
		[
			"TRANSFER_NORMAL/iban_transfer_repeat",
			"NAME SURNAME",
			"AUTOMATIC SCHEDULED TRANSFER",
			"-800.00",
			"2025-02-18",
		],
	];

	for (const [name, merchant, description, amount, date] of expected) {
		it(`derives ${name}`, () => {
			assert.deepEqual(derive(ipkoExample(name)).fields, {
				date,
				amount,
				currency: "PLN",
				merchant,
				description,
				isPending: false,
			});
		});
	}

	it("covers every example that is not a hold", () => {
		assert.deepEqual(
			expected.map(([name]) => name).toSorted(),
			Object.keys(ipkoExamples)
				.filter((name) => !name.startsWith("HOLD/"))
				.toSorted(),
		);
	});

	it("notes the original amount when a card payment was made in another currency", () => {
		const { fields } = derive(
			rawCardTransaction({ details: { original_amount: { amount: "15.90", currency: "EUR" } } }),
		);

		assert.equal(fields.description, "LIDL 3011, Wroclaw, POLSKA (orig 15.90 EUR)");
	});

	it("marks every field as coming from the defaults", () => {
		assert.deepEqual(
			new Set(Object.values(derive(rawCardTransaction()).fieldSources)),
			new Set(["default"]),
		);
	});
});

describe("deriveTransaction holds and errors", () => {
	it("reports a hold without deriving anything", () => {
		assert.deepEqual(deriveTransaction(rawHold(), []), { status: "hold" });
	});

	it("reports data the schemas do not know as a schema error", () => {
		const result = deriveTransaction(rawCardTransaction({ operation_type: "SOMETHING_NEW" }), []);

		assert.equal(result.status, "error");
		assert.equal(result.status === "error" && result.error.stage, "schema");
	});
});

describe("deriveTransaction rules", () => {
	const lidlRule = rule({
		id: "lidl",
		conditions: [{ path: "details.address", operator: "regex", pattern: "^LIDL (\\d+)" }],
		set: { merchant: "Lidl", description: "Lidl store {match.1} in {details.city}" },
	});

	it("overrides the fields a matching rule sets and records which rule did", () => {
		const { fields, fieldSources } = derive(rawCardTransaction(), [lidlRule]);

		assert.equal(fields.merchant, "Lidl");
		assert.equal(fields.description, "Lidl store 3011 in Wroclaw");
		assert.equal(fields.amount, "-57.33");
		assert.deepEqual(
			[fieldSources.merchant, fieldSources.description, fieldSources.amount],
			["lidl", "lidl", "default"],
		);
	});

	it("leaves transactions the rule does not match alone", () => {
		assert.equal(
			derive(rawTransferSend(), [lidlRule]).fields.merchant,
			"SOMEONE WHO RECEIVED MONEY",
		);
	});

	it("takes each field from the first rule by priority that sets it", () => {
		const { fields, fieldSources } = derive(rawCardTransaction(), [
			rule({ id: "late", priority: 2, set: { merchant: "Late", description: "Late" } }),
			rule({ id: "early", priority: 1, set: { merchant: "Early" } }),
		]);

		assert.deepEqual([fields.merchant, fields.description], ["Early", "Late"]);
		assert.deepEqual([fieldSources.merchant, fieldSources.description], ["early", "late"]);
	});

	it("ignores disabled rules and rules for other transaction types", () => {
		const { fields } = derive(rawCardTransaction(), [
			rule({ enabled: false, set: { merchant: "Disabled" } }),
			rule({ txTypes: ["fees"], set: { merchant: "Fees only" } }),
		]);

		assert.equal(fields.merchant, null);
	});

	it("can take the date from another field of the bank transaction", () => {
		const { fields } = derive(rawCardTransaction(), [
			rule({ set: { date: "{details.exec_date}" } }),
		]);

		assert.equal(fields.date, "2022-02-13");
	});

	it("shows rules the parsed transaction: known fields, its type, dates and amounts as text", () => {
		const { fields } = derive(rawCardTransaction({ field_the_schema_does_not_know: "raw only" }), [
			rule({
				set: {
					description:
						"{$type}|{money.amount}|{details.order_date}|{is_hold}|{field_the_schema_does_not_know}|",
				},
			}),
		]);

		assert.equal(fields.description, "cardTransaction|-57.33|2022-02-11|false||");
	});

	it("renders a placeholder for an absent field as empty text", () => {
		const { fields } = derive(rawCardTransaction(), [
			rule({
				set: { merchant: "{details.merchant_name}", description: "At {details.merchant_name}" },
			}),
		]);

		assert.deepEqual([fields.merchant, fields.description], [null, "At"]);
	});

	it("reports a value the field cannot hold as a rules error", () => {
		const result = deriveTransaction(rawCardTransaction(), [
			rule({ set: { date: "{details.address}" } }),
		]);

		assert.equal(result.status, "error");
		assert.equal(result.status === "error" && result.error.stage, "rules");
	});
});

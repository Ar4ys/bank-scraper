import { type Rule } from "@bank-scraper/shared";

import { MerchantMapField } from "../db/schema.ts";
import { IpkoTxType } from "../ipkoSchemas.ts";
import { matchText, type MerchantMap } from "./merchantMap.ts";
import { merchantKey, type MerchantDirectory } from "./merchants.ts";

/** A merchant map entry the migration creates, and the rules it comes from */
export type PlannedEntry = {
	field: MerchantMapField;
	text: string;
	merchant: string;
	fromRuleIds: string[];
};

/** Entries of one field and text that would name different merchants */
export type PlannedConflict = {
	field: MerchantMapField;
	text: string;
	merchants: string[];
	ruleIds: string[];
};

export type RuleMigrationPlan = {
	entries: PlannedEntry[];
	/** Rules that the entries replace */
	convertedRuleIds: string[];
	/** Rules that stay rules, and why */
	keptRules: Array<{ id: string; name: string; reason: string }>;
	conflicts: PlannedConflict[];
};

const pathFields: Record<string, MerchantMapField> = {
	"details.address": MerchantMapField.Address,
	"details.city": MerchantMapField.City,
};

const paymentTypes: readonly string[] = [IpkoTxType.CardTransaction, IpkoTxType.MobileTransaction];

/** Index of the `)` that closes the `(` at `open`, skipping escaped characters */
function closingParen(pattern: string, open: number): number | undefined {
	let depth = 0;

	for (let i = open; i < pattern.length; i++) {
		const char = pattern[i];
		if (char === "\\") {
			i++;
		} else if (char === "(") {
			depth++;
		} else if (char === ")" && --depth === 0) {
			return i;
		}
	}

	return undefined;
}

/** The pattern without groups, `(…)` and `(?:…)`, that span all of it */
function unwrapGroups(pattern: string): string {
	let inner = pattern;

	while (inner.startsWith("(") && closingParen(inner, 0) === inner.length - 1) {
		inner = inner.slice(inner.startsWith("(?:") ? 3 : 1, -1);
	}

	return inner;
}

/** The parts of a pattern between its `|` that are outside any group */
function splitAlternatives(pattern: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let start = 0;

	for (let i = 0; i < pattern.length; i++) {
		const char = pattern[i];
		if (char === "\\") i++;
		else if (char === "(") depth++;
		else if (char === ")") depth--;
		else if (char === "|" && depth === 0) {
			parts.push(pattern.slice(start, i));
			start = i + 1;
		}
	}

	return [...parts, pattern.slice(start)];
}

/** The text a regex part stands for, `undefined` if it is more than escaped literal text */
function literalText(part: string): string | undefined {
	let text = "";

	for (let i = 0; i < part.length; i++) {
		const char = part[i] ?? "";

		if (char === "\\") {
			const escaped = part[i + 1] ?? "";
			// `\d`, `\D`, `\b` and the like are classes or anchors, not the letter
			if (escaped === "" || /[\p{L}\p{N}]/u.test(escaped)) return undefined;
			text += escaped;
			i++;
		} else if (char === ".") {
			// Written as `intercity.pl`, meant as the dot
			text += ".";
		} else if ("*+?[]{}^$()|".includes(char)) {
			return undefined;
		} else {
			text += char;
		}
	}

	return text.trim() === "" ? undefined : text;
}

/**
 * The texts of a regex that is nothing but alternatives of literal text, like `((?:ACME)|(?:CORNER
 * CAFE))`, `undefined` for any other regex. An unescaped `.` is taken as a literal dot.
 */
export function parseLiteralAlternatives(pattern: string): string[] | undefined {
	const texts: string[] = [];

	for (const part of splitAlternatives(unwrapGroups(pattern))) {
		const inner = unwrapGroups(part);
		const nested = splitAlternatives(inner);
		const parsed = nested.length > 1 ? parseLiteralAlternatives(inner) : [literalText(inner)];

		if (!parsed || parsed.some((text) => text === undefined)) return undefined;
		texts.push(...parsed.flatMap((text) => text ?? []));
	}

	return texts;
}

/** Whether a regex is one capturing group around everything, so `{match.1}` is the whole match */
const isOneCapturingGroup = (pattern: string) =>
	pattern.startsWith("(") &&
	!pattern.startsWith("(?") &&
	closingParen(pattern, 0) === pattern.length - 1;

type Conversion = { entries: Array<Omit<PlannedEntry, "fromRuleIds">> } | { reason: string };

/** The entries that replace a rule, or why it stays a rule */
function convertRule(rule: Rule): Conversion {
	if (!rule.enabled) return { reason: "disabled" };
	if (!rule.txTypes?.length || rule.txTypes.some((type) => !paymentTypes.includes(type))) {
		return { reason: "not limited to card and mobile payments" };
	}

	const [condition, ...moreConditions] = rule.conditions;
	if (!condition || moreConditions.length) return { reason: "not exactly one condition" };

	const field = pathFields[condition.path];
	if (!field) return { reason: `a condition on ${condition.path}` };

	const setFields = Object.keys(rule.set);
	const merchant = rule.set.merchant;
	if (merchant === undefined || setFields.length !== 1) {
		return { reason: "does not set the merchant only" };
	}

	if (condition.operator === "regex") {
		const texts = parseLiteralAlternatives(condition.pattern);
		if (!texts) return { reason: "the regex is more than a list of texts" };

		if (merchant.trim() === "{match.1}") {
			if (!isOneCapturingGroup(condition.pattern)) {
				return { reason: "{match.1} is not the whole match" };
			}

			return {
				entries: texts.map((text) => ({ field, text: text.trim(), merchant: text.trim() })),
			};
		}

		if (merchant.includes("{")) return { reason: "the merchant uses placeholders" };

		return {
			entries: texts.map((text) => ({ field, text: text.trim(), merchant: merchant.trim() })),
		};
	}

	if (merchant.includes("{")) return { reason: "the merchant uses placeholders" };
	if (!condition.pattern.trim()) return { reason: "an empty pattern" };

	// `equals` becomes "contains", like every entry
	return { entries: [{ field, text: condition.pattern.trim(), merchant: merchant.trim() }] };
}

/** Entries with the same key match the same payments */
const groupKey = (field: string, text: string) => `${field}\n${matchText(text)}`;

/**
 * Which rules become merchant map entries and which stay. Entries of the same field and text (as
 * they are matched) become one when their merchants are the same merchant, which also holds for an
 * entry the map already has: that one is not added again. Otherwise they are a conflict, and the
 * migration has to be refused.
 */
export function planRuleMigration(
	rules: readonly Rule[],
	directory: MerchantDirectory,
	existing: MerchantMap,
): RuleMigrationPlan {
	/** The merchant a name stands for: its id, or the name itself while it is new */
	const merchantIdentity = (name: string) =>
		directory.get(merchantKey(name))?.id ?? `new:${merchantKey(name)}`;

	type Group = {
		entry: PlannedEntry;
		existing: boolean;
		merchants: Set<string>;
		names: Set<string>;
	};
	const groups = new Map<string, Group>();

	for (const entry of existing) {
		groups.set(groupKey(entry.field, entry.text), {
			entry: { field: entry.field, text: entry.text, merchant: entry.merchant, fromRuleIds: [] },
			existing: true,
			merchants: new Set([merchantIdentity(entry.merchant)]),
			names: new Set([entry.merchant]),
		});
	}

	const plan: RuleMigrationPlan = {
		entries: [],
		convertedRuleIds: [],
		keptRules: [],
		conflicts: [],
	};

	for (const rule of rules) {
		const conversion = convertRule(rule);
		if ("reason" in conversion) {
			plan.keptRules.push({ id: rule.id, name: rule.name, reason: conversion.reason });
			continue;
		}

		plan.convertedRuleIds.push(rule.id);

		for (const entry of conversion.entries) {
			const key = groupKey(entry.field, entry.text);
			const group = groups.get(key);

			if (group) {
				group.merchants.add(merchantIdentity(entry.merchant));
				group.names.add(entry.merchant);
				group.entry.fromRuleIds.push(rule.id);
			} else {
				groups.set(key, {
					entry: { ...entry, fromRuleIds: [rule.id] },
					existing: false,
					merchants: new Set([merchantIdentity(entry.merchant)]),
					names: new Set([entry.merchant]),
				});
			}
		}
	}

	for (const group of groups.values()) {
		if (group.merchants.size > 1) {
			plan.conflicts.push({
				field: group.entry.field,
				text: group.entry.text,
				merchants: [...group.names],
				ruleIds: [...new Set(group.entry.fromRuleIds)],
			});
		} else if (!group.existing) {
			plan.entries.push({ ...group.entry, fromRuleIds: [...new Set(group.entry.fromRuleIds)] });
		}
	}

	return plan;
}

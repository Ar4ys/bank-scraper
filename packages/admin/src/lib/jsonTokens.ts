export type JsonTokenKind = "key" | "string" | "number" | "literal" | "punctuation";

export interface JsonToken {
	kind: JsonTokenKind;
	text: string;
}

const string = String.raw`"(?:\\.|[^"\\])*"`;
const tokenPattern = new RegExp(
	[
		String.raw`(?<key>${string})(?=\s*:)`,
		`(?<string>${string})`,
		String.raw`(?<literal>\b(?:true|false|null)\b)`,
		String.raw`(?<number>-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)`,
	].join("|"),
	"g",
);

/**
 * Splits JSON text into tokens for syntax highlighting. Joining the `text` of the tokens gives the
 * input back: whitespace is part of the `punctuation` tokens.
 */
export function tokenizeJson(json: string): JsonToken[] {
	const tokens: JsonToken[] = [];
	let end = 0;

	for (const match of json.matchAll(tokenPattern)) {
		if (match.index > end) {
			tokens.push({ kind: "punctuation", text: json.slice(end, match.index) });
		}

		const [kind] = Object.entries(match.groups ?? {}).find(([, text]) => text !== undefined) ?? [];
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion
		tokens.push({ kind: kind as JsonTokenKind, text: match[0] });
		end = match.index + match[0].length;
	}

	if (end < json.length) tokens.push({ kind: "punctuation", text: json.slice(end) });

	return tokens;
}

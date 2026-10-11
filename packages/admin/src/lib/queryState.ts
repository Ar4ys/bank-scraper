import { searchParams } from "sv-router";

// sv-router's own `get` guesses types, which turns the text "007" into the number 7
const read = (name: string) => new URLSearchParams(searchParams.toString()).get(name);

function write(name: string, text: string | undefined) {
	if (read(name) === (text ?? null)) return;

	// Replacing the history entry keeps Back leading out of the page instead of through every change
	if (text === undefined) searchParams.delete(name, undefined, { replace: true });
	else searchParams.set(name, text, { replace: true });
}

export type QueryState<T> = { value: T };

type Codec<T> = {
	/** `undefined` for text that is not a value, which then reads as the fallback */
	parse: (text: string) => T | undefined;
	format: (value: T) => string;
};

/**
 * State of a page that lives in the query string of its URL, so that reloading the page or coming
 * back to it through the browser's history restores it. Reading `value` is reactive.
 *
 * A value equal to `fallback` is left out of the URL.
 */
export function queryState<T>(name: string, fallback: T, codec: Codec<T>): QueryState<T> {
	return {
		get value() {
			const text = read(name);
			return (text === null ? undefined : codec.parse(text)) ?? fallback;
		},
		set value(next) {
			write(name, next === fallback ? undefined : codec.format(next));
		},
	};
}

export const queryText = (name: string) =>
	queryState(name, "", { parse: (text) => text, format: (value) => value });

/** `false` unless the URL says `true` */
export const queryFlag = (name: string) =>
	queryState(name, false, { parse: (text) => text === "true", format: String });

/** A whole number that is not negative, `0` unless the URL has one */
export const queryCount = (name: string) =>
	queryState(name, 0, {
		parse: (text) => {
			const count = Number(text);
			return Number.isInteger(count) && count >= 0 ? count : undefined;
		},
		format: String,
	});

/** One of `options`, `fallback` when the URL has none of them */
export const queryOption = <const T extends string>(
	name: string,
	options: readonly T[],
	fallback: NoInfer<T>,
) =>
	queryState<T>(name, fallback, {
		parse: (text) => options.find((option) => option === text),
		format: (value) => value,
	});

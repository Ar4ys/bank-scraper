function getByPath(value: unknown, path: string): unknown {
	let current = value;

	for (const key of path.split(".")) {
		if (typeof current !== "object" || current === null) return undefined;
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion
		current = (current as Record<string, unknown>)[key];
	}

	return current;
}

/** Text of the value at a dot path, `undefined` when there is nothing at that path */
export function getTextByPath(value: unknown, path: string): string | undefined {
	const found = getByPath(value, path);

	if (found === undefined || found === null) return undefined;
	if (typeof found === "string") return found;

	return JSON.stringify(found);
}

/**
 * Replaces every `{path}` placeholder with the value at that dot path of `context`, and every
 * `{match.N}` with the Nth capture group. A placeholder that points at nothing renders as empty
 * text.
 */
export function renderTemplate(
	template: string,
	context: unknown,
	captures: readonly (string | undefined)[] = [],
): string {
	return template.replaceAll(/\{([^{}]+)\}/g, (_, path: string) => {
		const capture = /^match\.(\d+)$/.exec(path);
		if (capture) return captures[Number(capture[1])] ?? "";

		return getTextByPath(context, path) ?? "";
	});
}

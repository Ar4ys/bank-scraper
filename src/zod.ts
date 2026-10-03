import { z } from "zod";

import { TransactionAmount } from "./db/schema.ts";

type DeepMask<T extends Record<string, any>> = {
	[K in keyof T]?: T[K] extends Record<string, any> ? DeepMask<T[K]> : true;
};

function zodDeepPick<const T extends DeepMask<any>>(
	mask: T,
	from: z.ZodObject,
	currentPath: string[] = [],
): z.ZodObject {
	const entries = Object.entries(mask)
		.filter((entry): entry is [string, true | DeepMask<any>] => entry[1] !== undefined)
		.map(([key, value]) => {
			if (typeof value === "boolean") {
				return [key, from.shape[key]];
			}

			const supposedlyObjectSchema = from.shape[key];

			if (!(supposedlyObjectSchema instanceof z.ZodObject)) {
				throw new TypeError(
					`Cannot proceed with "${currentPath.join(".")}" - schema is not a ZodObject`,
				);
			}

			return [key, zodDeepPick(value, supposedlyObjectSchema, [...currentPath, key])];
		});

	return z.object(Object.fromEntries(entries));
}

function deepMaskToPaths(deepMask: DeepMask<Record<string, any>>): string[][] {
	const paths = Object.entries(deepMask)
		.filter((entry): entry is [string, true | DeepMask<any>] => entry[1] !== undefined)
		.flatMap(([key, value]) => {
			if (typeof value === "boolean") {
				return [[key]];
			}

			return deepMaskToPaths(value).map((subPaths) => [key, ...subPaths]);
		});

	return paths;
}

type ZodMdu<T extends readonly z.ZodObject[]> = z.ZodCodec<
	z.ZodCustom<z.input<T[number]>>,
	z.ZodCustom<z.output<T[number]>>
>;

type ZodMduIssue = z.core.$ZodIssueCustom & {
	readonly code_custom: "invalid_mdu";
	readonly discriminators: string[];
	readonly paths: string[][];
};

type ZodMduItemIssue = z.core.$ZodIssueCustom & {
	readonly code_custom: "invalid_mdu_item";
	readonly errors: z.core.$ZodIssue[];
	readonly note: string;
};

function isZodMduIssue(issue: z.core.$ZodIssueBase): issue is ZodMduIssue | ZodMduItemIssue {
	return (
		issue.code === "custom" &&
		"code_custom" in issue &&
		typeof issue.code_custom === "string" &&
		["invalid_mdu", "invalid_mdu_item"].includes(issue.code_custom)
	);
}

export function zMdu<
	const D extends DeepMask<z.infer<T[number]>>,
	const T extends readonly z.ZodObject[],
>(discriminators: D, schemas: T): ZodMdu<T> {
	const discriminatorPaths = deepMaskToPaths(discriminators);
	const discriminatorPathsDotSeparated = discriminatorPaths.map((path) => path.join("."));
	const configs = schemas.map((schema, i) => {
		try {
			return { schema, discriminator: zodDeepPick(discriminators, schema) };
		} catch (e) {
			let errorMessage = `Unable to get discriminators for schema at index ${i}`;
			if (schema.description) errorMessage += ` (${schema.description})`;
			throw new Error(errorMessage, { cause: e });
		}
	});

	return z.codec(z.custom<z.input<T[number]>>(), z.custom<z.output<T[number]>>(), {
		decode: (value, ctx) => {
			const processedConfigs = configs
				.entries()
				.filter(([, config]) => config.discriminator.safeParse(value).success)
				.map(([i, config]) => ({
					i,
					description: config.schema.description,
					result: config.schema.safeParse(value),
				}))
				.toArray();

			if (processedConfigs.length === 0) {
				ctx.issues.push({
					code: "custom",
					code_custom: "invalid_mdu",
					discriminators: discriminatorPathsDotSeparated,
					paths: discriminatorPaths,
					path: discriminatorPaths[0],
					message: "Invalid discriminator combination",
					input: value,
				} satisfies ZodMduIssue);

				return z.NEVER;
			}

			const collectedIssues: z.core.$ZodRawIssue<ZodMduItemIssue>[] = [];

			for (const { i, description, result } of processedConfigs) {
				// oxlint-disable-next-line typescript/no-unsafe-type-assertion
				if (result.success) return result.data as z.output<T[number]>;

				let note = `While parsing schema in union at index ${i}`;
				if (description) note += ` (${description})`;

				collectedIssues.push({
					code: "custom",
					code_custom: "invalid_mdu_item",
					note: note,
					errors: result.error.issues,
					path: [],
					message: "Invalid input",
					input: value,
				});
			}

			if (collectedIssues.length === 1) {
				ctx.issues.push(
					...collectedIssues[0].errors.map((issue) => ({
						input: undefined,
						note: collectedIssues[0].note,
						...issue,
					})),
				);
			} else {
				ctx.issues.push(...collectedIssues);
			}

			return z.NEVER;
		},

		// oxlint-disable-next-line typescript/no-unsafe-type-assertion
		encode: (data) => data as z.input<T[number]>,
	});
}

export const zPlainDate = z.codec(z.string(), z.instanceof(Temporal.PlainDate), {
	decode: (value) => Temporal.PlainDate.from(value),
	encode: (value) => value.toString(),
});

export const zTransactionAmount = z.codec(
	z.string().regex(/-?\d+(\.\d{2})?/, "Transaction amount must have format: 0.00 or -0.00"),
	z.bigint().transform(TransactionAmount),
	{
		decode: (value) => BigInt(!value.includes(".") ? value + "00" : value.replace(".", "")),
		encode: (value) => {
			const integerPart = value / 100n;
			let fractionalPart = value / 100n;
			if (fractionalPart < 0n) fractionalPart = -fractionalPart;

			return `${integerPart}.${fractionalPart}`;
		},
	},
);

export function zodPrettifyError(error: { issues: z.core.$ZodIssue[] }): string {
	const lines: string[] = [];
	const issues = [...error.issues].toSorted(
		(a, b) => (a.path ?? []).length - (b.path ?? []).length,
	);

	for (const issue of issues) {
		lines.push(`✖ ${issue.message}`);

		if ("note" in issue) lines.push(`  → note: ${String(issue.note)}`);
		if (isZodMduIssue(issue)) {
			if (issue.code_custom === "invalid_mdu" && issue.paths.length) {
				lines.push(`  → at ${issue.paths.map((path) => path.join(".")).join(", ")}`);
			}

			if (issue.code_custom === "invalid_mdu_item") {
				lines.push(`  → issues:`);
				lines.push(
					zodPrettifyError({ issues: issue.errors })
						.split("\n")
						.map((l) => " ".repeat(4) + l)
						.join("\n"),
				);
			}
		} else {
			if (issue.path?.length) lines.push(`  → at ${z.core.toDotPath(issue.path)}`);
		}
	}

	return lines.join("\n");
}

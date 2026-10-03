import { createHash } from "node:crypto";

import { type Hook } from "@hono/zod-validator";
import * as hono from "hono";
import { stableHash } from "stable-hash";
import { z } from "zod";

type EnumLike = Readonly<Record<string, string | number>>;
export type DefineEnum<T extends EnumLike> = T[keyof T];

export function jsonSha256(arg: unknown) {
	return createHash("sha256").update(stableHash(arg)).digest("hex");
}

export const zValidatorHook = <
	T,
	E extends hono.Env,
	P extends string,
	Target extends keyof hono.ValidationTargets = keyof hono.ValidationTargets,
	O = {},
	Schema extends z.ZodSchema = any,
>(
	...[result, c]: Parameters<Hook<T, E, P, Target, O, Schema>>
): ReturnType<Hook<T, E, P, Target, O, Schema>> => {
	if (c.req.header("Content-Type") !== "application/json")
		return c.json(
			{
				success: false,
				error: "Expected Content-Type to be application/json",
			},
			400,
		);

	if (result.success) return;

	return c.json(
		{
			success: false,
			error: z.flattenError(result.error),
		},
		400,
	);
};

export function assertNever(value: never, message?: string): never {
	throw new Error(message ?? "Unreachable reached", { cause: value });
}

const brand = Symbol("brand");
export type Branded<T, Brand extends string> = T & { [brand]: Brand };
export const createBrander =
	<TBase, TBranded extends Branded<TBase, any>>() =>
	(value: TBase): TBranded =>
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion
		value as any as TBranded;

const brand = Symbol("brand");
export type Branded<T, Brand extends string> = T & { [brand]: Brand };
export const createBrander =
	<TBase, TBranded extends Branded<TBase, any>>() =>
	(value: TBase): TBranded =>
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion
		value as any as TBranded;

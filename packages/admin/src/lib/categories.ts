import type { SureCategory } from "$lib/api";

/** A category as the pickers show it: a subcategory with its parent, "Parent › Child" */
export const categoryLabel = (category: SureCategory) =>
	category.parentName ? `${category.parentName} › ${category.name}` : category.name;

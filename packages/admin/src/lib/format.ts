/** `2026-08-17T16:39:36.741Z` as local date and time */
export const formatInstant = (instant: string) =>
	new Date(instant).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });

export const formatJson = (value: unknown) =>
	typeof value === "string" ? value : JSON.stringify(value, null, 2);

/** What caused a version of a transaction, in words */
export const causeLabels: Record<string, string> = {
	raw: "New data from the bank",
	rules: "Rules changed",
	reprocess: "Code changed",
	merchants: "Merchants changed",
	"merchant-map": "Merchant map changed",
};

/** Tailwind classes for an amount: income stands out, spending stays neutral */
export const amountClass = (amount: string) =>
	amount.startsWith("-") ? "" : "text-green-700 dark:text-green-400";

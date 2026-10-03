/** `2026-08-17T16:39:36.741Z` as local date and time */
export const formatInstant = (instant: string) =>
	new Date(instant).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });

export const formatJson = (value: unknown) =>
	typeof value === "string" ? value : JSON.stringify(value, null, 2);

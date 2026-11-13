<script lang="ts">
	import { defaultFieldSource, diffJson, mapEntryIdOfSource } from "@bank-scraper/shared";

	import { loadAccounts, type Account, type ProcessingReport } from "$lib/api";
	import JsonDiff from "$lib/components/JsonDiff.svelte";
	import { Button } from "$lib/components/ui/button";
	import { amountClass, causeLabels } from "$lib/format";
	import { p } from "$lib/router";

	type Change = ProcessingReport["changes"][number];
	type Failure = ProcessingReport["errors"][number];

	let { report }: { report: ProcessingReport } = $props();

	let accounts = $state<Account[]>([]);
	void loadAccounts().then((loaded) => (accounts = loaded));

	// The filters are reset by a new report: the dialogs keep this component when they preview again
	const unfiltered = (_report: ProcessingReport): string | undefined => undefined;
	/** Only changes of this field are listed */
	let fieldFilter = $derived(unfiltered(report));
	/** Only changes of fields this rule (or `defaultFieldSource`) sets now or set before are listed */
	let ruleFilter = $derived(unfiltered(report));

	// A rules error is caused by what is being previewed; a schema error was there before it
	const ruleErrors = $derived(report.errors.filter((failure) => failure.error.stage === "rules"));
	const schemaErrors = $derived(report.errors.filter((failure) => failure.error.stage !== "rules"));

	const changedFields = $derived(
		new Map(
			report.changes.map((change) => [
				change,
				diffJson(change.before ?? {}, change.after).map((entry) => entry.path),
			]),
		),
	);

	/** Rule ids, or `defaultFieldSource`, that set a field after and before the change */
	const sourcesOf = (change: Change, field: string) => [
		...new Set([
			change.fieldSources[field as keyof Change["fieldSources"]],
			change.fieldSourcesBefore?.[field as keyof Change["fieldSources"]],
		]),
	];

	const matches = (change: Change, field: string | undefined, rule: string | undefined) =>
		(changedFields.get(change) ?? []).some(
			(changed) =>
				(field === undefined || changed === field) &&
				(rule === undefined || sourcesOf(change, changed).includes(rule)),
		);

	const countBy = (keys: (change: Change) => Array<string | undefined>) => {
		const counts = new Map<string, number>();
		for (const change of report.changes) {
			for (const key of new Set(keys(change))) {
				if (key !== undefined) counts.set(key, (counts.get(key) ?? 0) + 1);
			}
		}
		return [...counts].toSorted(([, a], [, b]) => b - a);
	};

	// Each filter counts what the other one leaves
	const fieldCounts = $derived(
		countBy((change) =>
			(changedFields.get(change) ?? []).filter((field) => matches(change, field, ruleFilter)),
		),
	);
	const ruleCounts = $derived(
		countBy((change) =>
			(changedFields.get(change) ?? [])
				.filter((field) => fieldFilter === undefined || field === fieldFilter)
				.flatMap((field) => sourcesOf(change, field)),
		),
	);

	const shownChanges = $derived(
		report.changes.filter((change) => matches(change, fieldFilter, ruleFilter)),
	);

	const accountName = (id: number) => accounts.find((account) => account.id === id)?.name ?? id;

	const ruleName = (source: string) => {
		if (source === defaultFieldSource) return "code";
		if (mapEntryIdOfSource(source) !== undefined) {
			return report.sourceNames[source] ?? "Map entry (deleted)";
		}

		return report.sourceNames[source] ?? source;
	};

	const sourceNote = (source: string | undefined) => {
		if (source === undefined) return undefined;
		if (source === defaultFieldSource || mapEntryIdOfSource(source) !== undefined) {
			return ruleName(source);
		}

		return `rule: ${ruleName(source)}`;
	};

	/** What set each changed field, and what set it before when that was something else */
	const notesOf = (change: Change) =>
		Object.fromEntries(
			(changedFields.get(change) ?? []).map((field) => {
				const [after, before] = sourcesOf(change, field);
				return [field, { after: sourceNote(after), before: sourceNote(before) }];
			}),
		);

	// The transaction once it exists, its raw transaction while the change would create it
	const href = (item: Change | Failure) =>
		"transactionId" in item && item.transactionId
			? p("/transactions/:id", { params: { id: item.transactionId } })
			: p("/raw/:accountId/:bankId", {
					params: { accountId: String(item.accountId), bankId: item.bankId },
				});
</script>

{#snippet transaction(
	item: Change | Failure,
	fields: Change["after"] | null,
	txType: string | null,
	label: string,
)}
	<div class="space-y-0.5 text-sm">
		<div class="flex flex-wrap items-baseline gap-x-3">
			{#if fields}
				<span class="tabular-nums">{fields.date}</span>
			{/if}
			<span class="text-muted-foreground">{accountName(item.accountId)}</span>
			{#if fields}
				<span class="tabular-nums {amountClass(fields.amount)}">{fields.amount} {fields.currency}</span>
			{/if}
			<span class="text-xs text-muted-foreground">{label}</span>
			<!-- A preview is looked at next to what it previews, so its links open elsewhere -->
			<a
				class="ml-auto font-mono text-xs text-muted-foreground underline-offset-4 hover:underline"
				href={href(item)}
				target="_blank"
				rel="noopener"
				title="Open in a new tab"
			>
				{item.bankId} ↗
			</a>
		</div>
		<div class="flex min-w-0 items-baseline gap-x-3">
			{#if txType}
				<span class="shrink-0 font-mono text-xs text-blue-700 dark:text-blue-300">{txType}</span>
			{/if}
			{#if fields}
				{#if fields.merchant}
					<span class="shrink-0 font-medium">{fields.merchant}</span>
				{:else}
					<span class="shrink-0 text-muted-foreground">no merchant</span>
				{/if}
				<span class="truncate text-muted-foreground" title={fields.description}>{fields.description}</span>
			{/if}
		</div>
	</div>
{/snippet}

{#snippet failures(list: Failure[])}
	{#each list as failure (failure.rawTransactionId)}
		<div class="space-y-2 rounded-md border p-3">
			{@render transaction(failure, failure.fields, failure.txType, failure.fields ? "without rules" : "")}
			<pre class="whitespace-pre-wrap break-all rounded bg-destructive/10 p-2 text-xs">{failure.error.message}</pre>
		</div>
	{/each}
{/snippet}

{#snippet filter(label: string, counts: Array<[string, number]>, name: (key: string) => string, selected: string | undefined, select: (key: string | undefined) => void)}
	<div class="flex flex-wrap items-center gap-1 text-sm">
		<span class="mr-1 text-muted-foreground">{label}</span>
		<Button size="xs" variant={selected === undefined ? "secondary" : "ghost"} onclick={() => select(undefined)}>
			all
		</Button>
		{#each counts as [key, count] (key)}
			<Button size="xs" variant={selected === key ? "secondary" : "ghost"} onclick={() => select(key)}>
				{name(key)} <span class="tabular-nums text-muted-foreground">{count}</span>
			</Button>
		{/each}
	</div>
{/snippet}

<p class="text-sm">
	<span class="font-medium">{report.changes.length} would change</span>, {report.unchanged} stay the
	same{#if report.holds}, {report.holds} are holds{/if}.
</p>

{#if ruleErrors.length}
	<p class="text-sm font-medium text-destructive">
		{ruleErrors.length} would fail because a rule produces a value its field cannot hold:
	</p>
	{@render failures(ruleErrors)}
{/if}

{#if report.changes.length}
	<div class="space-y-1">
		{@render filter("Field", fieldCounts, (field) => field, fieldFilter, (field) => (fieldFilter = field))}
		{@render filter("Set by", ruleCounts, ruleName, ruleFilter, (rule) => (ruleFilter = rule))}
	</div>
	{#if shownChanges.length !== report.changes.length}
		<p class="text-xs text-muted-foreground">Showing {shownChanges.length} of {report.changes.length}.</p>
	{/if}
{/if}

{#each shownChanges as change (change.rawTransactionId)}
	<div class="space-y-2 rounded-md border p-3">
		{@render transaction(
			change,
			change.after,
			change.txType,
			change.before ? causeLabels[change.cause] : "New transaction",
		)}
		<JsonDiff before={change.before} after={change.after} notes={notesOf(change)} />
	</div>
{/each}

{#if schemaErrors.length}
	<details class="space-y-2 text-sm">
		<summary class="cursor-pointer text-muted-foreground">
			{schemaErrors.length} cannot be parsed at all, whatever the rules say
		</summary>
		{@render failures(schemaErrors)}
	</details>
{/if}

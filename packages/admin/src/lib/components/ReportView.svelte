<script lang="ts">
	import type { ProcessingReport } from "$lib/api";
	import JsonDiff from "$lib/components/JsonDiff.svelte";
	import { causeLabels } from "$lib/format";

	let { report }: { report: ProcessingReport } = $props();

	// A rules error is caused by what is being previewed; a schema error was there before it
	const ruleErrors = $derived(report.errors.filter((failure) => failure.error.stage === "rules"));
	const schemaErrors = $derived(report.errors.filter((failure) => failure.error.stage !== "rules"));
</script>

{#snippet failures(list: ProcessingReport["errors"])}
	{#each list as failure (failure.rawTransactionId)}
		<div class="space-y-1">
			<p class="font-mono text-xs">{failure.bankId}</p>
			<pre class="whitespace-pre-wrap break-all rounded bg-destructive/10 p-2 text-xs">{failure.error.message}</pre>
		</div>
	{/each}
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

{#each report.changes as change (change.rawTransactionId)}
	<div class="space-y-1">
		<p class="text-xs">
			<span class="font-mono">{change.bankId}</span>
			· {change.before ? causeLabels[change.cause] : "New transaction"}
		</p>
		<JsonDiff before={change.before} after={change.after} />
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

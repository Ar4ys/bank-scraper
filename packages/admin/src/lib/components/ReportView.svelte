<script lang="ts">
	import type { ProcessingReport } from "$lib/api";
	import JsonDiff from "$lib/components/JsonDiff.svelte";

	let { report }: { report: ProcessingReport } = $props();
</script>

<p class="text-sm">
	{report.changes.length} would change, {report.unchanged} stay the same,
	{report.errors.length} fail, {report.holds} are holds.
</p>

{#each report.changes as change (change.rawTransactionId)}
	<div class="space-y-1">
		<p class="font-mono text-xs">{change.bankId} · {change.cause}</p>
		<JsonDiff before={change.before} after={change.after} />
	</div>
{/each}

{#each report.errors as failure (failure.rawTransactionId)}
	<div class="space-y-1">
		<p class="font-mono text-xs">{failure.bankId} · {failure.error.stage} error</p>
		<pre class="whitespace-pre-wrap rounded bg-destructive/10 p-2 text-xs">{failure.error.message}</pre>
	</div>
{/each}

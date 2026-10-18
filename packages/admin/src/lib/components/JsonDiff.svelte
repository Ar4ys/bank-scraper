<script lang="ts">
	import { diffJson } from "@bank-scraper/shared";

	import { formatJson } from "$lib/format";

	let {
		before,
		after,
		notes,
	}: {
		before: unknown;
		after: unknown;
		/** Text next to the old and the new value, by path */
		notes?: Record<string, { before?: string; after?: string }>;
	} = $props();

	// Nothing before means everything was added, field by field, not one change of the whole value
	const entries = $derived(diffJson(before ?? {}, after));
</script>

{#snippet value(text: string, note: string | undefined, colors: string)}
	<span class="flex items-start gap-2">
		<pre class="min-w-0 flex-1 whitespace-pre-wrap break-all rounded px-2 py-1 {colors}">{text}</pre>
		{#if note}
			<span class="shrink-0 py-1 font-sans text-muted-foreground">{note}</span>
		{/if}
	</span>
{/snippet}

{#if entries.length === 0}
	<p class="text-sm text-muted-foreground">No differences.</p>
{:else}
	<ul class="divide-y rounded-md border font-mono text-xs">
		{#each entries as entry (entry.path)}
			{@const note = notes?.[entry.path]}
			<li class="grid grid-cols-[minmax(10rem,1fr)_2fr] gap-3 px-3 py-2">
				<span class="break-all font-medium">{entry.path || "(root)"}</span>
				<span class="space-y-1">
					{#if entry.kind !== "added"}
						{@render value(
							`- ${formatJson(entry.before)}`,
							note?.before,
							"bg-red-500/10 text-red-700 dark:text-red-300",
						)}
					{/if}
					{#if entry.kind !== "removed"}
						{@render value(
							`+ ${formatJson(entry.after)}`,
							note?.after,
							"bg-green-500/10 text-green-700 dark:text-green-300",
						)}
					{/if}
				</span>
			</li>
		{/each}
	</ul>
{/if}

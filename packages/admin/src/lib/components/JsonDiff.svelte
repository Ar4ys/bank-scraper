<script lang="ts">
	import { diffJson } from "@bank-scraper/shared";

	import { formatJson } from "$lib/format";

	let { before, after }: { before: unknown; after: unknown } = $props();

	// Nothing before means everything was added, field by field, not one change of the whole value
	const entries = $derived(diffJson(before ?? {}, after));
</script>

{#if entries.length === 0}
	<p class="text-sm text-muted-foreground">No differences.</p>
{:else}
	<ul class="divide-y rounded-md border font-mono text-xs">
		{#each entries as entry (entry.path)}
			<li class="grid grid-cols-[minmax(10rem,1fr)_2fr] gap-3 px-3 py-2">
				<span class="break-all font-medium">{entry.path || "(root)"}</span>
				<span class="space-y-1">
					{#if entry.kind !== "added"}
						<pre
							class="whitespace-pre-wrap break-all rounded bg-red-500/10 px-2 py-1 text-red-700 dark:text-red-300">- {formatJson(
								entry.before,
							)}</pre>
					{/if}
					{#if entry.kind !== "removed"}
						<pre
							class="whitespace-pre-wrap break-all rounded bg-green-500/10 px-2 py-1 text-green-700 dark:text-green-300">+ {formatJson(
								entry.after,
							)}</pre>
					{/if}
				</span>
			</li>
		{/each}
	</ul>
{/if}

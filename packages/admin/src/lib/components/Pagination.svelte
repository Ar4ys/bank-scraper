<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import { pageItems } from "$lib/pages";

	let {
		offset = $bindable(),
		limit,
		total,
	}: { offset: number; limit: number; total: number } = $props();

	const current = $derived(Math.floor(offset / limit));
	const items = $derived(pageItems(current, Math.ceil(total / limit)));
</script>

<div class="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
	<span>
		{total === 0 ? 0 : offset + 1}–{Math.min(offset + limit, total)} of {total}
	</span>
	<span class="flex flex-wrap items-center gap-1">
		<Button variant="outline" size="sm" disabled={offset === 0} onclick={() => (offset = Math.max(0, offset - limit))}>
			Previous
		</Button>
		{#each items as page, index (index)}
			{#if page === null}
				<span class="px-1">…</span>
			{:else}
				<Button
					variant={page === current ? "default" : "ghost"}
					size="sm"
					class="min-w-8 tabular-nums"
					aria-current={page === current ? "page" : undefined}
					onclick={() => (offset = page * limit)}
				>
					{page + 1}
				</Button>
			{/if}
		{/each}
		<Button variant="outline" size="sm" disabled={offset + limit >= total} onclick={() => (offset += limit)}>
			Next
		</Button>
	</span>
</div>

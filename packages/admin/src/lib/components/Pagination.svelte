<script lang="ts">
	import { Button } from "$lib/components/ui/button";

	let {
		offset = $bindable(),
		limit,
		total,
	}: { offset: number; limit: number; total: number } = $props();
</script>

<div class="flex items-center justify-between text-sm text-muted-foreground">
	<span>
		{total === 0 ? 0 : offset + 1}–{Math.min(offset + limit, total)} of {total}
	</span>
	<span class="flex gap-2">
		<Button variant="outline" size="sm" disabled={offset === 0} onclick={() => (offset = Math.max(0, offset - limit))}>
			Previous
		</Button>
		<Button variant="outline" size="sm" disabled={offset + limit >= total} onclick={() => (offset += limit)}>
			Next
		</Button>
	</span>
</div>

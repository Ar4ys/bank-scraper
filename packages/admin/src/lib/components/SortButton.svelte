<script lang="ts" generics="K extends string">
	import type { QuerySort } from "$lib/sorting";

	let { sort, key, label }: { sort: QuerySort<K>; key: K; label: string } = $props();
</script>

<button
	class="inline-flex cursor-pointer items-center gap-1 hover:underline"
	title="Sort by this column"
	onclick={() => sort.sortBy(key)}
>
	{label}
	<span class="w-3 text-muted-foreground">
		{sort.key === key ? (sort.descending ? "↓" : "↑") : "↕"}
	</span>
</button>

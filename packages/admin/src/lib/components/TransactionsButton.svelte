<script lang="ts">
	import ReceiptText from "@lucide/svelte/icons/receipt-text";

	import { Button } from "$lib/components/ui/button";

	let { count, onclick }: { count: number; onclick: () => void } = $props();
</script>

<Button
	variant="ghost"
	size="sm"
	class="gap-1.5 tabular-nums"
	title="View transactions"
	aria-label="View {count} transactions"
	{onclick}
>
	{count}
	<ReceiptText class="text-muted-foreground" />
</Button>

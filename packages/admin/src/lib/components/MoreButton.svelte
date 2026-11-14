<script lang="ts">
	import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";

	import { Button } from "$lib/components/ui/button";

	let {
		disabled = false,
		onclick,
	}: {
		disabled?: boolean;
		/** Opens the shared `RowMenu` at this button */
		onclick: (anchor: HTMLElement) => void;
	} = $props();
</script>

<Button
	variant="ghost"
	size="icon-sm"
	aria-label="More actions"
	aria-haspopup="menu"
	{disabled}
	onclick={(event) => onclick(event.currentTarget)}
>
	<EllipsisVertical />
</Button>

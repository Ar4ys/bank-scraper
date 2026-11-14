<script lang="ts">
	import ChevronsUpDown from "@lucide/svelte/icons/chevrons-up-down";

	import type { SureCategory } from "$lib/api";
	import { Button } from "$lib/components/ui/button";
	import { categoryLabel } from "$lib/categories";

	let {
		value,
		categories,
		onclick,
	}: {
		/** Id of the picked Sure category, `null` for none */
		value: string | null;
		/** `undefined` while Sure's categories are unavailable, which disables the button */
		categories: SureCategory[] | undefined;
		/** Opens the shared `CategoryPopover` at this button */
		onclick: (anchor: HTMLElement) => void;
	} = $props();

	const picked = $derived(categories?.find((category) => category.id === value));
	const placeholder = $derived(
		value === null
			? "No category"
			: categories === undefined
				? "Unknown category"
				: "Missing in Sure",
	);
</script>

<Button
	variant="outline"
	size="sm"
	class="w-52 justify-between font-normal"
	aria-haspopup="listbox"
	disabled={categories === undefined}
	onclick={(event) => onclick(event.currentTarget)}
>
	<span class="flex min-w-0 items-center gap-2">
		{#if picked}
			<span class="size-2.5 shrink-0 rounded-full" style:background-color={picked.color}></span>
			<span class="truncate">{categoryLabel(picked)}</span>
		{:else}
			<span class="truncate {value === null ? 'text-muted-foreground' : 'text-destructive'}">
				{placeholder}
			</span>
		{/if}
	</span>
	<ChevronsUpDown class="opacity-50" />
</Button>

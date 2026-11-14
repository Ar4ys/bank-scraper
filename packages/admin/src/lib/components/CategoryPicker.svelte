<script lang="ts">
	import ChevronsUpDown from "@lucide/svelte/icons/chevrons-up-down";

	import type { SureCategory } from "$lib/api";
	import { Button } from "$lib/components/ui/button";
	import * as Command from "$lib/components/ui/command";
	import * as Popover from "$lib/components/ui/popover";

	let {
		value = $bindable(),
		categories,
	}: {
		/** Id of the picked Sure category, `null` for none */
		value: string | null;
		/** `undefined` while Sure's categories are unavailable, which disables the picker */
		categories: SureCategory[] | undefined;
	} = $props();

	let open = $state(false);
	let search = $state<HTMLInputElement | null>(null);

	const label = (category: SureCategory) =>
		category.parentName ? `${category.parentName} › ${category.name}` : category.name;

	const picked = $derived(categories?.find((category) => category.id === value));
	const placeholder = $derived(
		value === null
			? "No category"
			: categories === undefined
				? "Unknown category"
				: "Missing in Sure",
	);

	function pick(id: string | null) {
		value = id;
		open = false;
	}
</script>

{#snippet dot(color: string)}
	<span class="size-2.5 shrink-0 rounded-full" style:background-color={color}></span>
{/snippet}

<Popover.Root bind:open>
	<Popover.Trigger disabled={categories === undefined}>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="outline"
				size="sm"
				class="w-52 justify-between font-normal"
				role="combobox"
				aria-expanded={open}
			>
				<span class="flex min-w-0 items-center gap-2">
					{#if picked}
						{@render dot(picked.color)}
						<span class="truncate">{label(picked)}</span>
					{:else}
						<span class="truncate {value === null ? 'text-muted-foreground' : 'text-destructive'}">
							{placeholder}
						</span>
					{/if}
				</span>
				<ChevronsUpDown class="opacity-50" />
			</Button>
		{/snippet}
	</Popover.Trigger>
	<!-- The popover focuses its search, and the list scrolls its first item into view, before the
	     popover is positioned: either scrolled the page to the top -->
	<Popover.Content
		class="w-64 p-0"
		align="start"
		onOpenAutoFocus={(event) => {
			event.preventDefault();
			search?.focus({ preventScroll: true });
		}}
	>
		<Command.Root disableInitialScroll>
			<Command.Input bind:ref={search} placeholder="Category" />
			<Command.List>
				<Command.Empty>No category found</Command.Empty>
				<Command.Group>
					<Command.Item value="No category" onSelect={() => pick(null)}>
						<span class="text-muted-foreground">No category</span>
					</Command.Item>
					{#each categories ?? [] as category (category.id)}
						<Command.Item value={category.id} keywords={[label(category)]} onSelect={() => pick(category.id)}>
							{@render dot(category.color)}
							<span class="truncate">{label(category)}</span>
						</Command.Item>
					{/each}
				</Command.Group>
			</Command.List>
		</Command.Root>
	</Popover.Content>
</Popover.Root>

<script lang="ts">
	import type { SureCategory } from "$lib/api";
	import { categoryLabel } from "$lib/categories";
	import * as Command from "$lib/components/ui/command";
	import * as Popover from "$lib/components/ui/popover";

	let { categories }: { categories: SureCategory[] | undefined } = $props();

	let open = $state(false);
	let anchor = $state<HTMLElement>();
	let onpick: (id: string | null) => void = () => {};
	let search = $state<HTMLInputElement | null>(null);

	/** Opens the list at `at`, or closes it when it is already open there */
	export function show(at: HTMLElement, onchoose: (id: string | null) => void) {
		if (open && anchor === at) {
			open = false;
			return;
		}
		anchor = at;
		onpick = onchoose;
		open = true;
	}

	function pick(id: string | null) {
		onpick(id);
		open = false;
	}
</script>

<Popover.Root bind:open>
	<!-- The popover focuses its search, and the list scrolls its first item into view, before the
	     popover is positioned: either scrolled the page to the top -->
	<Popover.Content
		class="w-64 p-0"
		align="start"
		customAnchor={anchor}
		onOpenAutoFocus={(event) => {
			event.preventDefault();
			search?.focus({ preventScroll: true });
		}}
		onCloseAutoFocus={(event) => {
			event.preventDefault();
			anchor?.focus({ preventScroll: true });
		}}
		onInteractOutside={(event) => {
			// A click on its own button toggles the list in `show`, instead of closing and reopening it
			if (event.target instanceof Node && anchor?.contains(event.target)) event.preventDefault();
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
						<Command.Item
							value={category.id}
							keywords={[categoryLabel(category)]}
							onSelect={() => pick(category.id)}
						>
							<span class="size-2.5 shrink-0 rounded-full" style:background-color={category.color}></span>
							<span class="truncate">{categoryLabel(category)}</span>
						</Command.Item>
					{/each}
				</Command.Group>
			</Command.List>
		</Command.Root>
	</Popover.Content>
</Popover.Root>

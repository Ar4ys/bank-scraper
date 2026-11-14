<script lang="ts" module>
	export type RowMenuItem = {
		label: string;
		/** A second line under the label */
		hint?: string;
		destructive?: boolean;
		onselect: () => void;
	};
</script>

<script lang="ts">
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu";

	let open = $state(false);
	let anchor = $state<HTMLElement>();
	let items = $state<RowMenuItem[]>([]);

	/** Opens the menu with `withItems` at `at`, or closes it when it is already open there */
	export function show(at: HTMLElement, withItems: RowMenuItem[]) {
		if (open && anchor === at) {
			open = false;
			return;
		}
		anchor = at;
		items = withItems;
		open = true;
	}
</script>

<DropdownMenu.Root bind:open>
	<DropdownMenu.Content
		align="end"
		class="w-auto"
		customAnchor={anchor}
		onCloseAutoFocus={(event) => {
			event.preventDefault();
			anchor?.focus({ preventScroll: true });
		}}
		onInteractOutside={(event) => {
			// A click on its own button toggles the menu in `show`, instead of closing and reopening it
			if (event.target instanceof Node && anchor?.contains(event.target)) event.preventDefault();
		}}
	>
		{#each items as item, index (index)}
			<DropdownMenu.Item
				variant={item.destructive ? "destructive" : "default"}
				onSelect={item.onselect}
			>
				{#if item.hint}
					<div>
						<div>{item.label}</div>
						<div class="text-xs whitespace-nowrap text-muted-foreground">{item.hint}</div>
					</div>
				{:else}
					{item.label}
				{/if}
			</DropdownMenu.Item>
		{/each}
	</DropdownMenu.Content>
</DropdownMenu.Root>

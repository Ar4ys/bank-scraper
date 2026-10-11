<script lang="ts">
	import type { Account } from "$lib/api";

	let {
		value = $bindable(),
		accounts,
		onchange,
	}: { value: string; accounts: Account[]; onchange?: () => void } = $props();
</script>

<select bind:value {onchange} class="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
	<option value="">All accounts</option>
	{#each accounts as account (account.id)}
		<option value={String(account.id)}>{account.name}</option>
	{/each}
</select>

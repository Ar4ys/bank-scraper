<script lang="ts">
	import type { Account } from "$lib/api";

	let { value = $bindable(), accounts }: { value: string; accounts: Account[] } = $props();
</script>

<select bind:value class="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
	<option value="">All accounts</option>
	{#each accounts as account (account.id)}
		<option value={String(account.id)}>{account.name}</option>
	{/each}
</select>

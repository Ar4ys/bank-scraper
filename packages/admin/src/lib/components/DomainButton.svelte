<script lang="ts">
	import MerchantLogo from "$lib/components/MerchantLogo.svelte";
	import { Button } from "$lib/components/ui/button";

	let {
		value,
		clientId,
		onclick,
	}: {
		/** The picked domain, `null` for none */
		value: string | null;
		clientId: string | null;
		/** Opens the shared `DomainDialog` */
		onclick: () => void;
	} = $props();
</script>

<Button variant="outline" size="sm" class="w-44 justify-start gap-2 font-normal" {onclick}>
	<MerchantLogo {clientId} domain={value} />
	<span class="truncate {value ? '' : 'text-muted-foreground'}">{value ?? "No domain"}</span>
</Button>

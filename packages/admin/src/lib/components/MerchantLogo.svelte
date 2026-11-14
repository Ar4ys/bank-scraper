<script lang="ts">
	import { logoUrl } from "$lib/brandfetch";

	let { clientId, domain }: { clientId: string | null; domain: string | null } = $props();

	let failed = $state(false);
	$effect(() => {
		void domain;
		failed = false;
	});
</script>

{#if clientId && domain && !failed}
	<img
		class="size-5 shrink-0 rounded-sm"
		src={logoUrl(clientId, domain)}
		alt=""
		loading="lazy"
		onerror={() => (failed = true)}
	/>
{/if}

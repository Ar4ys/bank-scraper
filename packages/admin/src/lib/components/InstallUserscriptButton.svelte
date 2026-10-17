<script lang="ts">
	import { loadUserscript } from "$lib/api";
	import { Button, type ButtonSize } from "$lib/components/ui/button";

	let { size = "default" }: { size?: ButtonSize } = $props();

	const userscript = loadUserscript();
</script>

{#await userscript then { installPath, version }}
	<!-- FireMonkey offers to install the script in the new tab -->
	<Button
		{size}
		variant="outline"
		href={installPath}
		target="_blank"
		rel="noopener"
		disabled={version === null}
		title={version === null ? "The userscript is not built on the server" : `Version ${version}`}
	>
		Install userscript
	</Button>
{:catch error}
	<Button {size} variant="outline" disabled title={String(error)}>Install userscript</Button>
{/await}

<script lang="ts">
	import { Router } from "sv-router";

	import { isActive, p } from "$lib/router";

	const links = [
		{ href: p("/"), label: "Dashboard", active: () => isActive("/") },
		{ href: p("/transactions"), label: "Transactions", active: () => isActive.startsWith("/transactions") },
		{ href: p("/raw"), label: "Raw transactions", active: () => isActive.startsWith("/raw") },
		{ href: p("/rules"), label: "Rules", active: () => isActive("/rules") },
		{ href: p("/accounts"), label: "Accounts", active: () => isActive("/accounts") },
	];
</script>

<div class="min-h-screen bg-background text-foreground">
	<header class="border-b">
		<nav class="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3 text-sm">
			<span class="font-semibold">Bank Scraper</span>
			{#each links as link (link.href)}
				<a
					href={link.href}
					class={link.active() ? "font-medium" : "text-muted-foreground hover:text-foreground"}
				>
					{link.label}
				</a>
			{/each}
		</nav>
	</header>

	<main class="mx-auto max-w-7xl space-y-4 px-4 py-6">
		<Router />
	</main>
</div>

/**
 * The domain of a domain or URL typed by hand: its host, lower-cased and without a leading `www.`
 * (`https://www.Lidl.pl/de/` → `lidl.pl`). `undefined` when that isn't a `name.tld` domain.
 */
export function normalizeDomain(input: string): string | undefined {
	const text = input.trim();
	if (!text) return undefined;

	let host: string;
	try {
		host = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`).hostname;
	} catch {
		return undefined;
	}

	host = host.replace(/^www\./, "").replace(/\.$/, "");
	return /^([a-z\d-]+\.)+([a-z]{2,}|xn--[a-z\d-]+)$/.test(host) ? host : undefined;
}

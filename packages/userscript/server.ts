import "./global";
import { defer } from "./utils";

// Firemonkey drops a `@var` that has no default, so the key needs a placeholder to be declared at all
const unsetIngestApiKey = "changeme";

type RequestOptions = {
	/** Sent as JSON in a POST; without it the request is a GET */
	body?: unknown;
	/** Whether the route needs the ingest key */
	withKey?: boolean;
};

/** Calls the server. Returns its answer, or `undefined` after logging what failed. */
export async function requestServer(
	path: string,
	{ body, withKey = true }: RequestOptions = {},
): Promise<unknown> {
	if (withKey && ingestApiKey === unsetIngestApiKey) {
		console.error(
			'Ingest key is not set: fill in "Ingest API key" in the User Variables of the userscript',
		);
		return undefined;
	}

	const headers: Record<string, string> = withKey ? { "x-api-key": ingestApiKey } : {};
	const response = await GM.fetch(
		new URL(path, serverUrl),
		body === undefined
			? { headers }
			: {
					method: "POST",
					body: JSON.stringify(body),
					headers: { ...headers, "Content-Type": "application/json" },
				},
	);

	if (!response.ok) {
		console.error(`Request to ${path} failed (see below for more info)`);
		console.groupCollapsed("Request Info");
		using _ = defer(() => console.groupEnd());

		console.log("Request Body", body);
		console.log("Response", response);

		const responseData = await response
			.json()
			.then((value) => value ?? response.text())
			.catch(() => "<failed to read response body>");

		console.log("Response Body", responseData);
		return undefined;
	}

	try {
		const resBody: unknown = await response.json();
		return resBody;
	} catch (e) {
		console.error(`Could not parse the response of ${path} as json`, e);
		return undefined;
	}
}

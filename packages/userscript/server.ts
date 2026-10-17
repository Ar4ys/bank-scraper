import "./global";
import { defer } from "./utils";

// Firemonkey drops a `@var` that has no default, so the key needs a placeholder to be declared at all
const unsetIngestApiKey = "changeme";

/**
 * Calls the server with the ingest key: a POST of `body` as JSON when it is given, a GET otherwise.
 * Returns its answer, or `undefined` after logging what failed.
 */
export async function requestServer(path: string, body?: unknown): Promise<unknown> {
	if (ingestApiKey === unsetIngestApiKey) {
		console.error(
			'Ingest key is not set: fill in "Ingest API key" in the User Variables of the userscript',
		);
		return undefined;
	}

	const response = await GM.fetch(
		new URL(path, serverUrl),
		body === undefined
			? { headers: { "x-api-key": ingestApiKey } }
			: {
					method: "POST",
					body: JSON.stringify(body),
					headers: {
						"Content-Type": "application/json",
						"x-api-key": ingestApiKey,
					},
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

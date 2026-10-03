// oxlint-disable-next-line unicorn/require-module-specifiers
export {};

declare global {
	const unsafeWindow: typeof window;

	function exportFunction<T extends (...args: any) => any>(fn: T, window: Window): T;

	export namespace GM {
		interface RequestInit extends globalThis.RequestInit {
			/**
			 * If true, no cookie will be sent with the request (same as setting `credentials` to
			 * `"omit"`).
			 *
			 * @default false
			 */
			anonymous?: boolean;
		}

		/**
		 * The **`Response`** interface of the Fetch API represents the response to a request. This
		 * interface is not an actual **`Response`** but a stripped down copy provided to us by
		 * Firemonkey.
		 *
		 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Response)
		 */
		interface Response {
			/**
			 * This property is useless because we do not have access to the original Response object.
			 * Firemonkey already consumed the body and provides us with this "response proxy".
			 *
			 * @deprecated Useless
			 *
			 * [MDN Reference Web
			 * Response#bodyUsed](https://developer.mozilla.org/docs/Web/API/Request/bodyUsed)
			 */
			readonly bodyUsed: false;

			/**
			 * The **`headers`** read-only property of the Response interface contains the list of headers
			 * and their corresponding values. Unlike [Web
			 * Response#headers](https://developer.mozilla.org/docs/Web/API/Response/headers), it is not a
			 * Headers object and does not have corresponding methods
			 *
			 * [MDN Reference for Web
			 * Response#headers](https://developer.mozilla.org/docs/Web/API/Response/headers)
			 */
			readonly headers: Record<string, string>;

			/**
			 * The **`ok`** read-only property of the Response interface contains a Boolean stating
			 * whether the response was successful (status in the range 200-299) or not.
			 *
			 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Response/ok)
			 */
			readonly ok: boolean;

			/**
			 * The **`redirected`** read-only property of the Response interface indicates whether or not
			 * the response is the result of a request you made which was redirected.
			 *
			 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Response/redirected)
			 */
			readonly redirected: boolean;

			/**
			 * The **`status`** read-only property of the Response interface contains the HTTP status
			 * codes of the response.
			 *
			 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Response/status)
			 */
			readonly status: number;

			/**
			 * The **`statusText`** read-only property of the Response interface contains the status
			 * message corresponding to the HTTP status code in Response.status.
			 *
			 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Response/statusText)
			 */
			readonly statusText: string;

			/**
			 * The **`type`** read-only property of the Response interface contains the type of the
			 * response. The type determines whether scripts are able to access the response body and
			 * headers.
			 *
			 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Response/type)
			 */
			readonly type: ResponseType;

			/**
			 * The **`url`** read-only property of the Response interface contains the URL of the
			 * response. The value of the url property will be the final URL obtained after any
			 * redirects.
			 *
			 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Response/url)
			 */
			readonly url: string;

			/**
			 * Unlike Web `Response#arrayBuffer()`, this method does not "consume" the body, so it can be
			 * called multiple times without calling the `Response#clone()`.
			 *
			 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Response/arrayBuffer)
			 */
			arrayBuffer(): Promise<ArrayBuffer>;

			/**
			 * Unlike Web `Response#blob()`, this method does not "consume" the body, so it can be called
			 * multiple times without calling the `Response#clone()`.
			 *
			 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Response/blob)
			 */
			blob(): Promise<Blob>;

			/**
			 * Unlike Web `Response#bytes()`, this method does not "consume" the body, so it can be called
			 * multiple times without calling the `Response#clone()`.
			 *
			 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Response/bytes)
			 */
			bytes(): Promise<Uint8Array<ArrayBuffer>>;

			/**
			 * Unlike Web `Response#formData()`, this method does not "consume" the body, so it can be
			 * called multiple times without calling the `Response#clone()`.
			 *
			 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Response/formData)
			 */
			formData(): Promise<FormData>;

			/**
			 * Unlike Web `Response#json()`, this method:
			 *
			 * - Does not "consume" the body, so it can be called multiple times without calling the
			 *   `Response#clone()`
			 * - Does not throw an error on malformed JSON - instead it returns `null`
			 *
			 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Response/json)
			 */
			json(): Promise<any>;

			/**
			 * Unlike Web `Response#text()`, this method does not "consume" the body, so it can be called
			 * multiple times without calling the `Response#clone()`.
			 *
			 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Response/text)
			 */
			text(): Promise<string>;
		}
	}

	// oxlint-disable-next-line typescript/no-extraneous-class
	export class GM {
		static fetch(this: GM, input: string | URL, init?: GM.RequestInit): Promise<GM.Response>;

		/** Reads a value from the storage of this userscript */
		static getValue<T extends string | number | boolean>(
			this: GM,
			key: string,
			defaultValue?: T,
		): Promise<T | undefined>;

		/** Writes a value to the storage of this userscript */
		static setValue(this: GM, key: string, value: string | number | boolean): Promise<void>;

		/** Adds an entry to the menu of the userscript manager */
		static registerMenuCommand(this: GM, name: string, onClick: () => void): void;
	}
}

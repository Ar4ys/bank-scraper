const INTERCEPT_URL = "/ipko3/accounts/operations/completed/full";

async function main() {
	asyncSpyOn(unsafeWindow, "fetch", async ([url, options], response) => {
		if (url !== INTERCEPT_URL || options.method !== "POST") {
			return;
		}

		response = response.clone();

		const reqBody = JSON.parse(options.body);
		console.log("SWEET SWEET ACCOUNT", reqBody.data.filter_form.source_account);

		const resBody = await response.json();
		console.log("SWEET SWEET MONEY", resBody);
	});
}

main().catch(console.error);

function asyncSpyOn(obj, method, spy) {
	const orig = obj[method];
	obj[method] = exportFunction((...args) => {
		return new unsafeWindow.Promise(
			exportFunction(async (res, rej) => {
				try {
					const result = await orig(...args);

					try {
						await spy(args, result);
					} catch (e) {
						console.error("Failed spy:", e);
					}

					res(result);
				} catch (e) {
					rej(e);
				}
			}, unsafeWindow),
		);
	}, unsafeWindow);
}

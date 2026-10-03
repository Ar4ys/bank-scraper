// Usage: node flatten.js input.json output.json

import fs from "fs";

/*
 * Recursively flattens a nested object/array into dot-notation keys.
 *
 * Objects  -> dot notation:      { a: { b: 1 } }        => { "a.b": 1 }
 * Arrays   -> collapsed marker:  { a: [ {b:1}, {b:2} ] } => { "a[].b": 1, "a[].b": 2 }
 *             (we merge array elements under the same "a[].b" key rather than
 *              indexing "a.0.b", "a.1.b", ... — see note below on why)
 *
 * This is tuned for SCHEMA DISCOVERY, not for lossless round-tripping.
 */
function flatten(value: any, prefix = "", out: Record<any, any> = {}) {
	if (value === null || value === undefined) {
		out[prefix] = value;
		return out;
	}

	if (Array.isArray(value)) {
		if (value.length === 0) {
			out[prefix || "(root)"] = "[]"; // mark empty array explicitly
			return out;
		}
		for (const item of value) {
			if (item !== null && typeof item === "object") {
				flatten(item, `${prefix}[]`, out);
			} else {
				out[`${prefix}[]`] = item; // primitive array element
			}
		}
		return out;
	}

	if (typeof value === "object") {
		const keys = Object.keys(value);
		if (keys.length === 0) {
			out[prefix || "(root)"] = "{}"; // mark empty object explicitly
			return out;
		}
		for (const key of keys) {
			const path = prefix ? `${prefix}:${key}` : key;
			flatten(value[key], path, out);
		}
		return out;
	}

	// primitive
	out[prefix] = value;
	return out;
}

function main() {
	const [, , inFile, outFile] = process.argv;
	if (!inFile || !outFile) {
		console.error("Usage: node flatten.js input.json output.json");
		process.exit(1);
	}

	const data: any[] = JSON.parse(fs.readFileSync(inFile, "utf8"));
	const flattened = data.map((obj) => flatten(obj));

	fs.writeFileSync(outFile, JSON.stringify(flattened, null, 2));
	console.log(`Flattened ${data.length} records -> ${outFile}`);
}

main();

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeDomain } from "./domain.ts";

describe("normalizeDomain", () => {
	it("keeps a bare domain, lower-cased", () => {
		assert.equal(normalizeDomain("lidl.pl"), "lidl.pl");
		assert.equal(normalizeDomain(" Lidl.PL "), "lidl.pl");
		assert.equal(normalizeDomain("shop.example.co.uk"), "shop.example.co.uk");
	});

	it("reduces a URL to its host without www.", () => {
		assert.equal(normalizeDomain("https://www.Lidl.pl/de/angebote?x=1"), "lidl.pl");
		assert.equal(normalizeDomain("http://bolt.eu"), "bolt.eu");
		assert.equal(normalizeDomain("www.zabka.pl/"), "zabka.pl");
		assert.equal(normalizeDomain("zabka.pl:8080/path"), "zabka.pl");
	});

	it("turns an international domain into its ASCII form", () => {
		assert.equal(normalizeDomain("żabka.pl"), "xn--abka-99a.pl");
		assert.equal(normalizeDomain("пример.рф"), "xn--e1afmkfd.xn--p1ai");
	});

	it("rejects what isn't name.tld", () => {
		assert.equal(normalizeDomain(""), undefined);
		assert.equal(normalizeDomain("lidl"), undefined);
		assert.equal(normalizeDomain("localhost:3000"), undefined);
		assert.equal(normalizeDomain("192.168.0.1"), undefined);
		assert.equal(normalizeDomain("not a domain.pl"), undefined);
		assert.equal(normalizeDomain("https://"), undefined);
	});
});

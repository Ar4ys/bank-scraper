import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { placeKey, proposeEntryText } from "./placeKey.ts";

describe("placeKey", () => {
	it("keeps the letters of an address only", () => {
		assert.equal(placeKey("LIDL 3011"), "lidl");
		assert.equal(placeKey("LIDL3012"), "lidl");
		assert.equal(placeKey("Żabka Z1234, ul. Długa 7"), "żabka z ul długa");
	});

	it("keeps Bolt's service code, with or without the slashes around it", () => {
		assert.equal(placeKey("BOLT.EU/O/2604081424"), "bolt eu o");
		assert.equal(placeKey("BOLT.EUO2604081424"), "bolt eu o");
		assert.equal(placeKey("BOLT.EU/D/2604081424"), "bolt eu d");
		assert.equal(placeKey("BOLT.EUD2401010101"), "bolt eu d");
		assert.equal(placeKey("BOLT.EU/CARDCHECK"), "bolt eu cardcheck");
	});

	it("is empty for an address of digits only", () => {
		assert.equal(placeKey("123 / 45"), "");
	});
});

describe("proposeEntryText", () => {
	it("takes the shared start, without the trailing digits", () => {
		assert.equal(proposeEntryText(["LIDL 3011", "LIDL 3012", "LIDL 3024"]), "LIDL");
		assert.equal(proposeEntryText(["BOLT.EU/O/2604081424", "BOLT.EU/O/2312261215"]), "BOLT.EU/O");
	});

	it("takes a shared middle, ignoring case and runs of whitespace", () => {
		assert.equal(proposeEntryText(["PAYU*Corner  Cafe 1", "corner cafe KRAKOW"]), "Corner Cafe");
	});

	it("comes out short for differently spelled addresses of one place", () => {
		assert.equal(proposeEntryText(["BOLT.EU/O/2604081424", "BOLT.EUO2604081424"]), "BOLT.EU");
	});

	it("is the address itself for a single one", () => {
		assert.equal(proposeEntryText(["CORNER  CAFE"]), "CORNER CAFE");
	});

	it("falls back to the shortest address when nothing with a letter is shared", () => {
		assert.equal(proposeEntryText(["ABC 12", "XYZ 12"]), "ABC 12");
	});
});

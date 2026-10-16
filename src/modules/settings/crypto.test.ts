import { describe, expect, it } from "vitest";
import { credentialCrypto } from "./crypto";

const secret = Buffer.alloc(32, 1).toString("base64");
describe("credential encryption", () => {
	it("round trips without plaintext in the ciphertext", () => {
		const crypto = credentialCrypto(secret);
		const encrypted = crypto.encrypt("openai", "private-provider-key");
		expect(crypto.decrypt("openai", encrypted)).toBe("private-provider-key");
		expect(encrypted.apiKeyCiphertext.toString()).not.toContain(
			"private-provider-key",
		);
	});
	it("returns unreadable for a different secret", () => {
		const crypto = credentialCrypto(secret);
		const other = credentialCrypto(Buffer.alloc(32, 2).toString("base64"));
		expect(other.secretKeyId).not.toBe(crypto.secretKeyId);
		expect(
			other.decrypt("openai", crypto.encrypt("openai", "private-key")),
		).toBeNull();
	});
	it("binds ciphertext to its provider", () => {
		const crypto = credentialCrypto(secret);
		expect(
			crypto.decrypt("anthropic", crypto.encrypt("openai", "private-key")),
		).toBeNull();
	});
	it("rejects a damaged tag", () => {
		const crypto = credentialCrypto(secret);
		const encrypted = crypto.encrypt("openai", "private-key");
		encrypted.apiKeyTag[0] ^= 1;
		expect(crypto.decrypt("openai", encrypted)).toBeNull();
	});
	it("uses a fresh 12-byte IV for each write", () => {
		const crypto = credentialCrypto(secret);
		const first = crypto.encrypt("openai", "private-key"),
			second = crypto.encrypt("openai", "private-key");
		expect(first.apiKeyIv.length).toBe(12);
		expect(first.apiKeyIv.equals(second.apiKeyIv)).toBe(false);
		expect(first.apiKeyCiphertext.equals(second.apiKeyCiphertext)).toBe(false);
	});
});

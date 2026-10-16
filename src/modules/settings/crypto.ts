import {
	createCipheriv,
	createDecipheriv,
	createHmac,
	hkdfSync,
	randomBytes,
} from "node:crypto";
import type { AiProviderName } from "#/server/config";

export interface EncryptedKey {
	apiKeyCiphertext: Buffer;
	apiKeyIv: Buffer;
	apiKeyTag: Buffer;
	secretKeyId: string;
}

export function credentialCrypto(secret: string) {
	const key = Buffer.from(
		hkdfSync(
			"sha256",
			Buffer.from(secret, "base64"),
			Buffer.alloc(0),
			"marginalia ai-credentials v1",
			32,
		),
	);
	const secretKeyId = createHmac("sha256", key)
		.update("marginalia secret key id v1")
		.digest()
		.subarray(0, 8)
		.toString("hex");
	return {
		secretKeyId,
		encrypt(provider: AiProviderName, value: string): EncryptedKey {
			const apiKeyIv = randomBytes(12);
			const cipher = createCipheriv("aes-256-gcm", key, apiKeyIv);
			cipher.setAAD(Buffer.from(provider));
			const apiKeyCiphertext = Buffer.concat([
				cipher.update(value, "utf8"),
				cipher.final(),
			]);
			return {
				apiKeyCiphertext,
				apiKeyIv,
				apiKeyTag: cipher.getAuthTag(),
				secretKeyId,
			};
		},
		decrypt(provider: AiProviderName, encrypted: EncryptedKey): string | null {
			if (encrypted.secretKeyId !== secretKeyId) return null;
			try {
				const decipher = createDecipheriv(
					"aes-256-gcm",
					key,
					encrypted.apiKeyIv,
				);
				decipher.setAAD(Buffer.from(provider));
				decipher.setAuthTag(encrypted.apiKeyTag);
				return Buffer.concat([
					decipher.update(encrypted.apiKeyCiphertext),
					decipher.final(),
				]).toString("utf8");
			} catch {
				return null;
			}
		},
	};
}

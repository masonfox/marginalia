import { createHash } from "node:crypto";
import type { AiCredentials, AiProviderName } from "#/server/config";
export function credentialsFingerprint(
	provider: AiProviderName,
	credentials: AiCredentials,
): string {
	return (
		provider +
		":" +
		createHash("sha256")
			.update(
				JSON.stringify([
					credentials.apiKey ?? null,
					credentials.baseUrl ?? null,
				]),
			)
			.digest("hex")
	);
}

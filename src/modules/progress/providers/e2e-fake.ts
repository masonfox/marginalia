// A fake list-mode provider for the end-to-end tests only. It is registered
// only when MARGINALIA_E2E_FAKE_PROGRESS=1 (see `e2eFakeProgressEnabled`),
// never by default. It reports one book, by the ISBN its config names, at
// the percentage its config names.
import type { ProgressProvider, ProviderConfig } from "../types";

export const e2eFake: ProgressProvider = {
	kind: "e2e-fake",
	label: "E2E Fake",
	configFields: [
		{
			key: "isbn",
			label: "ISBN",
			type: "text",
			required: true,
			hint: "The one book this fake reports.",
		},
		{
			key: "percent",
			label: "Percent read",
			type: "text",
			required: false,
			hint: "0 to 100; 60 when blank.",
		},
	],
	help: "Test-only provider for end-to-end tests.",
	async testConnection(cfg: ProviderConfig) {
		return cfg.isbn
			? { status: "ok", detail: "Fake provider." }
			: { status: "rejected", detail: "Set an ISBN." };
	},
	matching: {
		mode: "list",
		async list(cfg: ProviderConfig) {
			const isbn = cfg.isbn?.trim();
			if (!isbn) return [];
			const percent = Number(cfg.percent?.trim() || "60");
			return [
				{
					externalId: `e2e-${isbn}`,
					isbns: [isbn],
					ids: {},
					title: "E2E fake book",
					reading: {
						state: "reading",
						fraction: Math.min(1, Math.max(0, percent / 100)),
						observedAt: new Date(),
					},
				},
			];
		},
	},
};

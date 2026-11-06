import type { NamingMetadata, NamingPatch } from "#/modules/conversation";

export interface TrackedTitle {
	id: string;
	title: string;
	naming?: NamingMetadata;
}
type Listener = () => void;
type Entry = {
	source: TrackedTitle;
	patch: NamingPatch | null;
	deleted: boolean;
	listeners: Set<Listener>;
	forceUntil: number;
	finalFetched: boolean;
	generation: number;
};
/** One visible-tab scheduler shared by all mounted rows and the header. */
export class NamingPoller {
	private entries = new Map<string, Entry>();
	private timer: ReturnType<typeof setTimeout> | undefined;
	private queued = false;
	private active = false;
	private again = false;
	private request: AbortController | undefined;
	constructor(
		private fetch: (
			ids: string[],
			signal: AbortSignal,
		) => Promise<NamingPatch[]>,
		private visible: () => boolean = () => true,
		private now = () => Date.now(),
	) {}
	subscribe(source: TrackedTitle, listener: Listener): () => void {
		let entry = this.entries.get(source.id);
		if (!entry) {
			entry = {
				source,
				patch: null,
				deleted: false,
				listeners: new Set(),
				forceUntil: 0,
				finalFetched: false,
				generation: 0,
			};
			this.entries.set(source.id, entry);
		}
		this.seed(source);
		entry.listeners.add(listener);
		this.reconcile();
		return () => {
			if (!entry) return;
			entry.listeners.delete(listener);
			if (!entry.listeners.size) {
				entry.generation++;
				this.entries.delete(source.id);
			}
			if (this.entries.size === 0) this.request?.abort();
			this.schedule();
		};
	}
	seed(source: TrackedTitle) {
		const entry = this.entries.get(source.id);
		if (!entry) return;
		const advanced =
			(source.naming?.revision ?? -1) > (entry.source.naming?.revision ?? -1);
		if (
			(source.naming?.revision ?? -1) >= (entry.source.naming?.revision ?? -1)
		)
			entry.source = source;
		if (
			entry.patch &&
			(source.naming?.revision ?? -1) > entry.patch.naming.revision
		) {
			entry.patch = null;
			entry.finalFetched = false;
			this.emit(entry);
		}
		if (advanced) this.reconcile();
	}
	get(id: string): NamingPatch | null | undefined {
		const entry = this.entries.get(id);
		return entry?.deleted ? undefined : (entry?.patch ?? null);
	}
	isDeleted(id: string) {
		return this.entries.get(id)?.deleted ?? false;
	}
	begin(id: string) {
		const entry = this.entries.get(id);
		if (
			!entry ||
			entry.source.naming?.locked ||
			!["eligible", "pending", "running"].includes(
				(entry.patch ?? entry.source).naming?.state ?? "",
			)
		)
			return;
		entry.forceUntil = this.now() + 30_000;
		entry.finalFetched = false;
		this.reconcile();
	}
	renamed(id: string, title: string) {
		this.request?.abort();
		const entry = this.entries.get(id);
		if (!entry) return;
		entry.generation++;
		const current = entry.patch ?? entry.source;
		// A claimed attempt may still save its usage after the rename; keep a
		// bounded refresh until its persisted deadline so accounting can arrive.
		const deadline = current.naming?.deadline ?? null;
		const claimed =
			current.naming?.state === "running" && deadline
				? new Date(deadline).getTime()
				: 0;
		entry.forceUntil = claimed > this.now() ? claimed : 0;
		entry.finalFetched = entry.forceUntil === 0;
		entry.patch = {
			...entry.patch,
			id,
			title,
			naming: {
				state: "skipped",
				locked: true,
				expiresAt: null,
				deadline,
				revision: (current.naming?.revision ?? 0) + 1,
			},
		} as NamingPatch;
		this.emit(entry);
		this.reconcile();
	}
	reconcile() {
		if (this.queued || !this.visible()) return;
		this.queued = true;
		queueMicrotask(() => {
			this.queued = false;
			void this.poll(true);
		});
	}
	private emit(entry: Entry) {
		for (const listener of entry.listeners) listener();
	}
	/** A terminal claimed attempt whose usage has not been saved yet (e.g. after rename). */
	private awaitingAccounting(entry: Entry) {
		const patch = entry.patch;
		return (
			!!patch?.namingUsage?.missing &&
			!!patch.naming.deadline &&
			!["eligible", "pending", "running"].includes(patch.naming.state)
		);
	}
	private bound(entry: Entry) {
		const meta = (entry.patch ?? entry.source).naming;
		const date =
			meta?.state === "running" || this.awaitingAccounting(entry)
				? meta?.deadline
				: meta?.state === "pending"
					? meta.expiresAt
					: null;
		return date ? new Date(date).getTime() : entry.forceUntil;
	}
	private pending(entry: Entry) {
		return (
			!entry.deleted &&
			!entry.finalFetched &&
			(entry.forceUntil > this.now() ||
				// Stays selectable through the deadline so one expired reconciliation
				// runs; finalFetched stops it afterward.
				this.awaitingAccounting(entry) ||
				["pending", "running"].includes(
					(entry.patch ?? entry.source).naming?.state ?? "",
				))
		);
	}
	private schedule() {
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
		if (
			this.visible() &&
			[...this.entries.values()].some((e) => this.pending(e))
		)
			this.timer = setTimeout(() => {
				this.timer = undefined;
				void this.poll(false);
			}, 1000);
	}
	private async poll(all: boolean) {
		if (this.active) {
			this.again ||= all;
			return;
		}
		if (!this.visible()) {
			this.schedule();
			return;
		}
		this.active = true;
		const entries = [...this.entries.values()].filter(
			(e) => !e.deleted && (all || this.pending(e)),
		);
		try {
			for (let offset = 0; offset < entries.length; offset += 100) {
				const batch = entries.slice(offset, offset + 100).map((entry) => ({
					entry,
					generation: entry.generation,
					expired: this.bound(entry) > 0 && this.bound(entry) <= this.now(),
				}));
				try {
					const request = new AbortController();
					this.request = request;
					const timer = setTimeout(() => request.abort(), 5000);
					let abort: (() => void) | undefined;
					let patches: NamingPatch[];
					try {
						patches = await Promise.race([
							this.fetch(
								batch.map(({ entry }) => entry.source.id),
								request.signal,
							),
							new Promise<never>((_, reject) => {
								abort = () => reject(new Error("Metadata request aborted"));
								request.signal.addEventListener("abort", abort, { once: true });
							}),
						]);
					} finally {
						clearTimeout(timer);
						if (abort) request.signal.removeEventListener("abort", abort);
						if (this.request === request) this.request = undefined;
					}
					const byId = new Map(patches.map((p) => [p.id, p]));
					for (const { entry, generation, expired } of batch) {
						if (
							this.entries.get(entry.source.id) !== entry ||
							generation !== entry.generation
						)
							continue;
						const patch = byId.get(entry.source.id);
						if (!patch) {
							entry.deleted = true;
							entry.finalFetched = true;
						} else {
							const current = entry.patch ?? entry.source;
							if (
								(!current.naming?.locked || patch.naming.locked) &&
								patch.naming.revision >= (current.naming?.revision ?? -1)
							)
								entry.patch = patch;
							if (patch.naming.state !== "eligible") entry.forceUntil = 0;
							entry.finalFetched =
								(!["eligible", "pending", "running"].includes(
									patch.naming.state,
								) &&
									(!this.awaitingAccounting(entry) || expired)) ||
								(expired && this.bound(entry) <= this.now());
						}
						this.emit(entry);
					}
				} catch {
					for (const { entry, generation, expired } of batch)
						if (entry.generation === generation && expired)
							entry.finalFetched = true;
				}
			}
		} finally {
			this.active = false;
			if (this.again) {
				this.again = false;
				this.reconcile();
			} else this.schedule();
		}
	}
}

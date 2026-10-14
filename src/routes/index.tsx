import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { BookOpen, RefreshCw, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
	listEditionsFn,
	rescanLibrary,
	retryFailedImport,
} from "#/fns/library";

const editionsQuery = queryOptions({
	queryKey: ["editions"],
	queryFn: () => listEditionsFn(),
});

export const Route = createFileRoute("/")({
	loader: ({ context }) => context.queryClient.ensureQueryData(editionsQuery),
	component: LibraryPage,
});

const rootApi = getRouteApi("__root__");

const STATUS_LABEL = {
	processing: "Processing",
	ready: "Ready",
	failed: "Failed",
	unavailable: "Unavailable",
} as const;

function LibraryPage() {
	const shell = rootApi.useLoaderData();
	const { data: editions = [] } = useQuery({
		...editionsQuery,
		// Poll while anything is being imported, so status changes appear without a reload.
		refetchInterval: (query) =>
			query.state.data?.some((e) => e.status === "processing") ? 3000 : false,
	});

	return (
		<main className="mx-auto max-w-5xl px-4 py-8">
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<h1 className="font-serif text-3xl font-semibold">Library</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						{editions.length === 1 ? "1 book" : `${editions.length} books`}
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					{shell.hasLibraryPaths && <RescanButton />}
					<UploadControl maxUploadMb={shell.maxUploadMb} />
				</div>
			</div>

			{editions.length === 0 ? (
				<div className="mt-12 rounded-lg border border-dashed p-10 text-center">
					<BookOpen
						className="mx-auto size-8 text-muted-foreground"
						aria-hidden
					/>
					<h2 className="mt-3 font-medium">No books yet</h2>
					<p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
						Upload an EPUB with the button above, or mount a folder of EPUBs and
						list it in <code className="text-xs">MARGINALIA_LIBRARY_PATHS</code>{" "}
						so it is scanned automatically.
					</p>
				</div>
			) : (
				<ul className="mt-8 grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4">
					{editions.map((e) => (
						<li key={e.id} className="flex flex-col">
							<Link
								to="/books/$editionId"
								params={{ editionId: e.id }}
								className="group block"
							>
								<Cover id={e.id} title={e.title} hasCover={e.hasCover} />
								<h2 className="mt-2 line-clamp-2 font-medium group-hover:underline">
									{e.title}
								</h2>
							</Link>
							{e.authors.length > 0 && (
								<p className="line-clamp-1 text-sm text-muted-foreground">
									{e.authors.join(", ")}
								</p>
							)}
							<div className="mt-1">
								<Badge
									variant={
										e.status === "failed"
											? "destructive"
											: e.status === "ready"
												? "secondary"
												: "outline"
									}
								>
									{STATUS_LABEL[e.status]}
								</Badge>
							</div>
							{e.status === "failed" && (
								<FailedImport id={e.id} error={e.error} />
							)}
						</li>
					))}
				</ul>
			)}
		</main>
	);
}

function Cover({
	id,
	title,
	hasCover,
}: {
	id: string;
	title: string;
	hasCover: boolean;
}) {
	if (hasCover) {
		return (
			<img
				src={`/api/covers/${id}`}
				alt=""
				loading="lazy"
				className="aspect-[2/3] w-full rounded-md border object-cover"
			/>
		);
	}
	return (
		<div
			aria-hidden
			className="flex aspect-[2/3] w-full items-center justify-center rounded-md border bg-muted p-3 text-center font-serif text-sm text-muted-foreground"
		>
			{title}
		</div>
	);
}

function FailedImport({ id, error }: { id: string; error: string | null }) {
	const queryClient = useQueryClient();
	const retry = useServerFn(retryFailedImport);
	const [busy, setBusy] = useState(false);
	return (
		<div className="mt-2 space-y-1">
			{error && <p className="text-sm text-destructive-foreground">{error}</p>}
			<Button
				size="sm"
				variant="outline"
				disabled={busy}
				onClick={async () => {
					setBusy(true);
					try {
						await retry({ data: { editionId: id } });
						await queryClient.invalidateQueries({ queryKey: ["editions"] });
					} finally {
						setBusy(false);
					}
				}}
			>
				Retry
			</Button>
		</div>
	);
}

function RescanButton() {
	const rescan = useServerFn(rescanLibrary);
	const [message, setMessage] = useState<string | null>(null);
	return (
		<div className="flex items-center gap-2">
			{message && (
				<span className="text-sm text-muted-foreground">{message}</span>
			)}
			<Button
				variant="outline"
				onClick={async () => {
					const { enqueued } = await rescan({ data: { full: false } });
					setMessage(enqueued ? "Rescan started" : "A scan is already running");
				}}
			>
				<RefreshCw aria-hidden /> Rescan library
			</Button>
		</div>
	);
}

function UploadControl({ maxUploadMb }: { maxUploadMb: number }) {
	const queryClient = useQueryClient();
	const input = useRef<HTMLInputElement>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const upload = async (file: File) => {
		setError(null);
		if (file.size > maxUploadMb * 1024 * 1024) {
			setError(`The file is larger than the ${maxUploadMb} MB upload limit.`);
			return;
		}
		setBusy(true);
		try {
			const body = new FormData();
			body.set("file", file, file.name);
			const res = await fetch("/api/uploads", { method: "POST", body });
			if (!res.ok) {
				const payload = (await res.json().catch(() => null)) as {
					error?: string;
				} | null;
				setError(payload?.error ?? `Upload failed (${res.status}).`);
				return;
			}
			await queryClient.invalidateQueries({ queryKey: ["editions"] });
		} catch {
			setError("Upload failed. Check your connection and try again.");
		} finally {
			setBusy(false);
			if (input.current) input.current.value = "";
		}
	};

	return (
		<div className="flex flex-col items-end gap-1">
			<input
				ref={input}
				type="file"
				accept=".epub,application/epub+zip"
				className="sr-only"
				id="upload"
				onChange={(e) => {
					const file = e.target.files?.[0];
					if (file) void upload(file);
				}}
			/>
			<Button disabled={busy} onClick={() => input.current?.click()}>
				<Upload aria-hidden /> {busy ? "Uploading…" : "Upload EPUB"}
			</Button>
			{error && (
				<p
					role="alert"
					className="max-w-xs text-right text-sm text-destructive-foreground"
				>
					{error}
				</p>
			)}
		</div>
	);
}

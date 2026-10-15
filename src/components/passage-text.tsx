/**
 * A passage's text, with an optional highlighted range. Its DOM text equals
 * `text`, so selection offsets inside it (see selectionToPassageRef) are
 * offsets into the stored passage.
 */
export function PassageText({
	locator,
	text,
	range,
}: {
	locator: string;
	text: string;
	range: { start: number; end: number } | null;
}) {
	return (
		<span data-passage-text={locator}>
			{range && range.end <= text.length ? (
				<>
					{text.slice(0, range.start)}
					<mark
						data-testid="quote-highlight"
						className="rounded-sm bg-primary/25 px-0.5 text-foreground"
					>
						{text.slice(range.start, range.end)}
					</mark>
					{text.slice(range.end)}
				</>
			) : (
				text
			)}
		</span>
	);
}

/** A book's cover, or a placeholder with its title when it has none. */
export function BookCover({
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

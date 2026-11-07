import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Slot } from "radix-ui";
import type * as React from "react";

/**
 * Statuses are a colored dot and a word, with no filled pill (the mockups'
 * .badge); give `status` its color with a text class such as
 * `text-status-reading`. `secondary` and `outline` are quiet label chips
 * (the mockups' .chip) for tags that are not statuses.
 */
const badgeVariants = cva(
	"inline-flex w-fit shrink-0 items-center gap-1.5 overflow-hidden whitespace-nowrap transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none [&>svg]:pointer-events-none [&>svg]:size-3",
	{
		variants: {
			variant: {
				status:
					"text-[11.5px] leading-none font-semibold tracking-[0.02em] before:block before:size-[7px] before:shrink-0 before:rounded-full before:bg-current",
				default:
					"text-[11.5px] leading-none font-semibold tracking-[0.02em] text-foreground before:block before:size-[7px] before:shrink-0 before:rounded-full before:bg-current",
				destructive:
					"text-[11.5px] leading-none font-semibold tracking-[0.02em] text-destructive-foreground before:block before:size-[7px] before:shrink-0 before:rounded-full before:bg-current",
				secondary:
					"min-h-6 rounded-full border border-border bg-secondary px-2.5 text-xs font-medium text-muted-foreground [a&]:hover:text-foreground",
				outline:
					"min-h-6 rounded-full border border-input px-2.5 text-xs font-medium text-muted-foreground [a&]:hover:bg-secondary [a&]:hover:text-foreground",
				ghost:
					"text-xs font-medium text-muted-foreground [a&]:hover:text-foreground",
				link: "text-xs font-medium text-amber-foreground underline-offset-4 [a&]:hover:underline",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

function Badge({
	className,
	variant = "default",
	asChild = false,
	...props
}: React.ComponentProps<"span"> &
	VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
	const Comp = asChild ? Slot.Root : "span";

	return (
		<Comp
			data-slot="badge"
			data-variant={variant}
			className={cn(badgeVariants({ variant }), className)}
			{...props}
		/>
	);
}

export { Badge, badgeVariants };

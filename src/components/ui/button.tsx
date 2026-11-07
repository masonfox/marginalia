import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Slot } from "radix-ui";
import type * as React from "react";

/** Buttons per the mockups' .btn: 40px tall (44 on touch), 10px corners, 14px semibold. */
const buttonVariants = cva(
	"inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-transparent text-sm font-semibold whitespace-nowrap transition-[color,background-color,border-color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/25 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				default: "bg-primary text-primary-foreground hover:bg-primary/90",
				/** Filled; for the final step of deleting something. */
				destructive:
					"bg-destructive text-background hover:bg-destructive/90 focus-visible:ring-destructive/40",
				/** Outlined; for starting a destructive action. */
				"destructive-outline":
					"border-input bg-transparent text-destructive-foreground hover:bg-destructive/10 focus-visible:ring-destructive/40",
				outline:
					"border-input bg-transparent text-foreground hover:bg-secondary",
				secondary:
					"border-border bg-secondary text-secondary-foreground hover:bg-secondary/70",
				ghost:
					"bg-transparent text-muted-foreground hover:bg-secondary hover:text-foreground",
				link: "rounded-sm border-0 text-amber-foreground underline-offset-4 hover:underline",
			},
			size: {
				default: "min-h-10 px-4 py-1 pointer-coarse:min-h-11",
				xs: "h-6 gap-1 rounded-md px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
				sm: "h-8 gap-1.5 rounded-lg px-3",
				lg: "min-h-11 px-5 py-1",
				icon: "size-10 pointer-coarse:size-11 [&_svg:not([class*='size-'])]:size-[18px]",
				"icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
				"icon-sm": "size-8 rounded-lg",
				"icon-lg": "size-11 [&_svg:not([class*='size-'])]:size-[18px]",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

function Button({
	className,
	variant = "default",
	size = "default",
	asChild = false,
	...props
}: React.ComponentProps<"button"> &
	VariantProps<typeof buttonVariants> & {
		asChild?: boolean;
	}) {
	const Comp = asChild ? Slot.Root : "button";

	return (
		<Comp
			data-slot="button"
			data-variant={variant}
			data-size={size}
			className={cn(buttonVariants({ variant, size, className }))}
			{...props}
		/>
	);
}

export { Button, buttonVariants };

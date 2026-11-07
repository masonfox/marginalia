import { cn } from "cn";
import type * as React from "react";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
	return (
		<input
			type={type}
			data-slot="input"
			className={cn(
				"h-11 w-full min-w-0 rounded-[12px] border border-input bg-card px-3.5 py-1 text-base text-foreground transition-[color,box-shadow,border-color] outline-none selection:bg-highlight selection:text-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-faint-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
				"focus-visible:border-amber focus-visible:ring-[3px] focus-visible:ring-ring",
				"aria-invalid:border-destructive aria-invalid:ring-destructive/25",
				className,
			)}
			{...props}
		/>
	);
}

export { Input };

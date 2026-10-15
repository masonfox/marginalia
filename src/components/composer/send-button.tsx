import { Send, Square } from "lucide-react";
import { useId } from "react";
import { Button } from "#/components/ui/button";

/** Why sending is unavailable outside a generation, or null when it is available. */
export function blockedReason({
	draft,
	checking,
}: {
	draft: string;
	checking: boolean;
}): string | null {
	if (!draft.trim()) return "Type a message";
	if (checking) return "Checking passage…";
	return null;
}

/**
 * The composer's one round control: Send, Stop in the same place while a reply
 * streams, or a dimmed Send that says why it is unavailable. It stays
 * focusable when blocked so the reason can be read.
 */
export function SendButton({
	busy,
	reason,
	onStop,
}: {
	busy: boolean;
	reason: string | null;
	onStop: () => void;
}) {
	const reasonId = useId();
	if (busy)
		return (
			<Button
				type="button"
				size="icon"
				variant="outline"
				className="rounded-full"
				aria-label="Stop"
				title="Stop"
				onClick={onStop}
			>
				<Square className="fill-current" aria-hidden />
			</Button>
		);
	return (
		<Button
			type="submit"
			size="icon"
			className="rounded-full aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
			aria-label="Send"
			aria-disabled={reason ? true : undefined}
			aria-describedby={reason ? reasonId : undefined}
			title={reason ?? "Send"}
			onClick={(e) => {
				if (reason) e.preventDefault();
			}}
		>
			<Send aria-hidden />
			{reason && (
				<span id={reasonId} className="sr-only">
					{reason}
				</span>
			)}
		</Button>
	);
}

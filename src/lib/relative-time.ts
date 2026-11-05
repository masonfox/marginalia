// "3 hours ago" style labels for when something last happened.

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
	["year", 365 * 24 * 60 * 60],
	["month", 30 * 24 * 60 * 60],
	["week", 7 * 24 * 60 * 60],
	["day", 24 * 60 * 60],
	["hour", 60 * 60],
	["minute", 60],
];

const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** How long before `now` the date was, in its largest whole unit; under a minute is "just now". */
export function relativeTime(date: Date, now: Date = new Date()): string {
	const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
	for (const [unit, size] of UNITS) {
		if (Math.abs(seconds) >= size)
			return format.format(-Math.trunc(seconds / size), unit);
	}
	return "just now";
}

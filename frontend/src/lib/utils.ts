import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export function relativeTime(dateString: string): string {
	// The backend emits naive ISO strings (no "Z" and no "+hh:mm"), which
	// `new Date(...)` interprets as *local* time. Our server timestamps are
	// UTC, so that mismatch showed up as "1h ago" for a conversation created
	// a second ago in UTC+1. Normalise by appending "Z" when neither a
	// timezone offset nor a Z is present.
	const hasTz = /Z$|[+-]\d{2}:?\d{2}$/.test(dateString);
	const date = new Date(hasTz ? dateString : `${dateString}Z`);

	const diffMs = Date.now() - date.getTime();
	// Clock skew between client and server can give a small negative diff
	// for freshly-created rows. Clamp to 0 so we show "just now" instead
	// of "-1m ago".
	const diffSec = Math.max(0, Math.floor(diffMs / 1000));
	const diffMin = Math.floor(diffSec / 60);
	const diffHr = Math.floor(diffMin / 60);
	const diffDay = Math.floor(diffHr / 24);

	if (diffSec < 60) return "just now";
	if (diffMin < 60) return `${diffMin}m ago`;
	if (diffHr < 24) return `${diffHr}h ago`;
	if (diffDay < 7) return `${diffDay}d ago`;
	return date.toLocaleDateString();
}

import { motion } from "framer-motion";
import {
	AlertTriangle,
	Bot,
	CircleCheck,
	CircleHelp,
	FileText,
	Loader2,
	ShieldAlert,
} from "lucide-react";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import type { ConfidenceLevel, Document, Message } from "../types";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface MessageBubbleProps {
	message: Message;
	documents?: Document[];
	onSelectDocument?: (id: string, page?: number) => void;
	// True when the backend is still running its judge pass on this
	// message. Shows a skeleton pill so the user knows a verdict is coming.
	judging?: boolean;
}

const CONFIDENCE_STYLES: Record<
	ConfidenceLevel,
	{ label: string; wrap: string; icon: typeof CircleCheck }
> = {
	high: {
		label: "High confidence",
		wrap: "border-emerald-200 bg-emerald-50 text-emerald-800",
		icon: CircleCheck,
	},
	medium: {
		label: "Medium confidence",
		wrap: "border-amber-200 bg-amber-50 text-amber-800",
		icon: CircleHelp,
	},
	low: {
		label: "Low confidence",
		wrap: "border-rose-200 bg-rose-50 text-rose-800",
		icon: ShieldAlert,
	},
};

// Must match backend `NO_ANSWER_PHRASE` in services/llm.py. When the model
// emits this sentence it's telling us it couldn't ground an answer — we
// want to reinforce that as a good outcome instead of flagging it as
// ungrounded.
const NO_ANSWER_PHRASE = "i can't find this in the documents you've uploaded.";

interface ResolvedCitation {
	document: Document;
	// First page cited for this document in the message body (if any). We
	// only surface one page per chip to keep the UI quiet; clicking jumps
	// there, and the user can read the surrounding prose for other pages.
	page: number | null;
}

/**
 * Find all citations in a message body and resolve them against the list
 * of currently-attached documents. Supports two forms:
 *
 *   [filename.pdf]              — doc-level citation
 *   [filename.pdf p.12]         — page-level citation (new)
 *
 * Tolerates case differences and an optional ".pdf" suffix. Returns one
 * entry per referenced document, in the order they first appear, carrying
 * the first page number seen for that document (if any).
 */
function resolveCitations(
	content: string,
	documents: Document[],
): ResolvedCitation[] {
	if (documents.length === 0) return [];

	// Capture group 1 = inside the brackets (filename + optional page ref).
	const CITATION_RE = /\[([^\]\n]+?)\]/g;
	const matches = content.match(CITATION_RE);
	if (!matches) return [];

	const byKey = new Map<string, Document>();
	for (const doc of documents) {
		const lower = doc.filename.toLowerCase();
		const stem = lower.replace(/\.pdf$/, "");
		byKey.set(lower, doc);
		byKey.set(stem, doc);
	}

	// Pull an optional "p.12" off the tail of the bracket contents.
	const PAGE_RE = /\bp\.\s*(\d+)\b/i;

	const firstHit = new Map<string, ResolvedCitation>();
	const order: string[] = [];

	for (const raw of matches) {
		const inner = raw.slice(1, -1).trim();
		const pageMatch = inner.match(PAGE_RE);
		const page = pageMatch?.[1] ? Number.parseInt(pageMatch[1], 10) : null;
		// Strip the page token so the remainder is just the filename.
		const fileRef = inner.replace(PAGE_RE, "").trim().toLowerCase();
		const candidate =
			byKey.get(fileRef) ?? byKey.get(fileRef.replace(/\.pdf$/, ""));
		if (!candidate) continue;

		const existing = firstHit.get(candidate.id);
		if (!existing) {
			firstHit.set(candidate.id, {
				document: candidate,
				page: Number.isFinite(page) ? page : null,
			});
			order.push(candidate.id);
		} else if (existing.page === null && page !== null) {
			// Prefer a chip with a page number if we see one later in the text.
			existing.page = page;
		}
	}

	return order
		.map((id) => firstHit.get(id))
		.filter((c): c is ResolvedCitation => c !== undefined);
}

export function MessageBubble({
	message,
	documents = [],
	onSelectDocument,
	judging = false,
}: MessageBubbleProps) {
	if (message.role === "system") {
		return (
			<motion.div
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				transition={{ duration: 0.2 }}
				className="flex justify-center py-2"
			>
				<p className="text-xs text-neutral-400">{message.content}</p>
			</motion.div>
		);
	}

	if (message.role === "user") {
		return (
			<motion.div
				initial={{ opacity: 0, y: 8 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.2 }}
				className="flex justify-end py-1.5"
			>
				<div className="max-w-[75%] rounded-2xl rounded-br-md bg-neutral-100 px-4 py-2.5">
					<p className="whitespace-pre-wrap text-sm text-neutral-800">
						{message.content}
					</p>
				</div>
			</motion.div>
		);
	}

	// Assistant message
	const citations = resolveCitations(message.content, documents);
	const trimmed = message.content.trim().toLowerCase();
	const isNoAnswer = trimmed.startsWith(NO_ANSWER_PHRASE);
	// Show the ungrounded warning only when: (a) we have documents attached
	// so an answer *should* have been grounded, (b) the model produced no
	// resolvable citations, and (c) the model didn't do the right thing and
	// say "I can't find this". (c) is key — we don't want to nag the user
	// when the model correctly refuses.
	const showUngroundedWarning =
		documents.length > 0 && citations.length === 0 && !isNoAnswer;

	// Confidence pill logic. We show the pill when the backend has
	// returned a verdict. While the judge is still running (`judging`) we
	// show a skeleton. We never fabricate a verdict — if the backend
	// decides not to judge (refusal, no docs, no page citations, judge
	// errored) we just don't render the pill at all.
	const verdict: ConfidenceLevel | null = message.confidence ?? null;
	const showConfidencePill = verdict !== null && !isNoAnswer;
	const showJudgingSkeleton = judging && !verdict && !isNoAnswer;
	return (
		<motion.div
			initial={{ opacity: 0, y: 8 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.2 }}
			className="flex gap-3 py-1.5"
		>
			<div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-neutral-900">
				<Bot className="h-4 w-4 text-white" />
			</div>
			<div className="min-w-0 max-w-[80%]">
				<div className="prose">
					<Streamdown>{message.content}</Streamdown>
				</div>
				{(showConfidencePill || showJudgingSkeleton) && (
					<div className="mt-2 flex flex-wrap items-center gap-1.5">
						{showConfidencePill && verdict && (
							<ConfidencePill
								level={verdict}
								reason={message.confidence_reason ?? null}
							/>
						)}
						{showJudgingSkeleton && <JudgingPill />}
					</div>
				)}
				{citations.length > 0 && (
					<div className="mt-2 flex flex-wrap gap-1.5">
						{citations.map(({ document: doc, page }) => (
							<button
								key={doc.id}
								type="button"
								onClick={() => onSelectDocument?.(doc.id, page ?? undefined)}
								className="inline-flex max-w-[260px] items-center gap-1 rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-xs text-neutral-600 transition-colors hover:border-neutral-300 hover:bg-neutral-100 hover:text-neutral-800"
								title={
									page !== null
										? `Open ${doc.filename} at page ${page}`
										: `Open ${doc.filename} in the viewer`
								}
							>
								<FileText className="h-3 w-3 flex-shrink-0" />
								<span className="truncate">{doc.filename}</span>
								{page !== null && (
									<span className="flex-shrink-0 text-neutral-400">
										· p.{page}
									</span>
								)}
							</button>
						))}
					</div>
				)}
				{showUngroundedWarning && (
					<div
						role="note"
						className="mt-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
					>
						<AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
						<span>
							This answer isn't grounded in a specific passage of your uploaded
							documents. Verify before relying on it.
						</span>
					</div>
				)}
			</div>
		</motion.div>
	);
}

interface ConfidencePillProps {
	level: ConfidenceLevel;
	reason: string | null;
}

function ConfidencePill({ level, reason }: ConfidencePillProps) {
	const { label, wrap, icon: Icon } = CONFIDENCE_STYLES[level];
	// When we have a reason, make the pill a tooltip trigger so hovering
	// reveals the judge's rationale. Reason strings are capped at 300 chars
	// server-side, which fits comfortably in a tooltip.
	const content = (
		<span
			className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${wrap}`}
		>
			<Icon className="h-3 w-3" />
			<span>{label}</span>
		</span>
	);
	if (!reason) return content;
	return (
		<Tooltip>
			<TooltipTrigger asChild>{content}</TooltipTrigger>
			<TooltipContent side="top" className="max-w-xs">
				<p className="text-xs leading-snug">{reason}</p>
			</TooltipContent>
		</Tooltip>
	);
}

function JudgingPill() {
	return (
		<span className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-xs text-neutral-500">
			<Loader2 className="h-3 w-3 animate-spin" />
			<span>Verifying…</span>
		</span>
	);
}

interface StreamingBubbleProps {
	content: string;
}

export function StreamingBubble({ content }: StreamingBubbleProps) {
	return (
		<div className="flex gap-3 py-1.5">
			<div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-neutral-900">
				<Bot className="h-4 w-4 text-white" />
			</div>
			<div className="min-w-0 max-w-[80%]">
				{content ? (
					<div className="prose">
						<Streamdown mode="streaming">{content}</Streamdown>
					</div>
				) : (
					<div className="flex items-center gap-1 py-2">
						<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400" />
						<span
							className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400"
							style={{ animationDelay: "0.15s" }}
						/>
						<span
							className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400"
							style={{ animationDelay: "0.3s" }}
						/>
					</div>
				)}
				<span className="inline-block h-4 w-0.5 animate-pulse bg-neutral-400" />
			</div>
		</div>
	);
}

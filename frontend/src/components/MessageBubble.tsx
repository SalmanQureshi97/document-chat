import { motion } from "framer-motion";
import { Bot, FileText } from "lucide-react";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import type { Document, Message } from "../types";

interface MessageBubbleProps {
	message: Message;
	documents?: Document[];
	onSelectDocument?: (id: string) => void;
}

/**
 * Find all [filename] citations in a message body and resolve them
 * against the list of currently-attached documents. Tolerates:
 *   - case differences
 *   - missing ".pdf" suffix
 *   - either filename-with-suffix or just the stem
 * Returns unique `Document`s in the order they first appear in the text.
 */
function resolveCitations(content: string, documents: Document[]): Document[] {
	if (documents.length === 0) return [];

	const matches = content.match(/\[([^\]\n]+?)\]/g);
	if (!matches) return [];

	const byKey = new Map<string, Document>();
	for (const doc of documents) {
		const lower = doc.filename.toLowerCase();
		const stem = lower.replace(/\.pdf$/, "");
		byKey.set(lower, doc);
		byKey.set(stem, doc);
	}

	const seen = new Set<string>();
	const result: Document[] = [];
	for (const raw of matches) {
		const inner = raw.slice(1, -1).trim().toLowerCase();
		// Try both the exact match and the .pdf-stripped stem
		const candidate =
			byKey.get(inner) ?? byKey.get(inner.replace(/\.pdf$/, ""));
		if (candidate && !seen.has(candidate.id)) {
			seen.add(candidate.id);
			result.push(candidate);
		}
	}
	return result;
}

export function MessageBubble({
	message,
	documents = [],
	onSelectDocument,
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
				{citations.length > 0 ? (
					<div className="mt-2 flex flex-wrap gap-1.5">
						{citations.map((doc) => (
							<button
								key={doc.id}
								type="button"
								onClick={() => onSelectDocument?.(doc.id)}
								className="inline-flex max-w-[240px] items-center gap-1 rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-xs text-neutral-600 transition-colors hover:border-neutral-300 hover:bg-neutral-100 hover:text-neutral-800"
								title={`Open ${doc.filename} in the viewer`}
							>
								<FileText className="h-3 w-3 flex-shrink-0" />
								<span className="truncate">{doc.filename}</span>
							</button>
						))}
					</div>
				) : (
					message.sources_cited > 0 && (
						<p className="mt-1.5 text-xs text-neutral-400">
							{message.sources_cited} source
							{message.sources_cited !== 1 ? "s" : ""} cited
						</p>
					)
				)}
			</div>
		</motion.div>
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

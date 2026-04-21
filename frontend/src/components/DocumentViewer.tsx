import {
	ChevronLeft,
	ChevronRight,
	FileText,
	Loader2,
	Plus,
	X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Document as PDFDocument, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import type { CitationJump } from "../hooks/use-documents";
import { getDocumentUrl } from "../lib/api";
import type { Document } from "../types";
import { Button } from "./ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "./ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
	"pdfjs-dist/build/pdf.worker.min.mjs",
	import.meta.url,
).toString();

const MIN_WIDTH = 280;
const MAX_WIDTH = 700;
const DEFAULT_WIDTH = 440;

interface PageState {
	currentPage: number;
	numPages: number;
}

interface DocumentViewerProps {
	documents: Document[];
	selectedDocumentId: string | null;
	onSelectDocument: (id: string) => void;
	onDeleteDocument: (id: string) => Promise<void>;
	onUploadDocument: (file: File) => Promise<unknown>;
	uploading: boolean;
	// Citation-driven page jump. Consumed via an effect that reacts to the
	// monotonic `tick` so the same (doc, page) click fires again.
	pendingJump?: CitationJump | null;
}

export function DocumentViewer({
	documents,
	selectedDocumentId,
	onSelectDocument,
	onDeleteDocument,
	onUploadDocument,
	uploading,
	pendingJump,
}: DocumentViewerProps) {
	// Per-document page state, keyed by document id. Switching tabs preserves
	// the page position you were on.
	const [pageState, setPageState] = useState<Record<string, PageState>>({});
	const [pdfLoading, setPdfLoading] = useState(true);
	const [pdfError, setPdfError] = useState<string | null>(null);

	const [width, setWidth] = useState(DEFAULT_WIDTH);
	const [dragging, setDragging] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const [pendingDelete, setPendingDelete] = useState<Document | null>(null);

	const selectedDocument =
		documents.find((d) => d.id === selectedDocumentId) ?? null;

	// Reset PDF loading when the selected doc changes so the loader shows.
	// biome-ignore lint/correctness/useExhaustiveDependencies: selectedDocumentId changing is the exact trigger we want
	useEffect(() => {
		setPdfLoading(true);
		setPdfError(null);
	}, [selectedDocumentId]);

	// React to a citation-driven jump. We key on `tick` so the same
	// (documentId, page) combination clicked repeatedly still re-applies
	// — the user might want to "jump back" after scrolling away.
	// biome-ignore lint/correctness/useExhaustiveDependencies: tick is the intentional trigger
	useEffect(() => {
		if (!pendingJump) return;
		const { documentId, page } = pendingJump;
		setPageState((prev) => {
			const current = prev[documentId] ?? { currentPage: 1, numPages: 0 };
			// Clamp if we know the page count; otherwise let onLoadSuccess
			// clamp later. Either way we honour the requested page as best we
			// can — better to land on page 1 than on nothing.
			const clamped =
				current.numPages > 0
					? Math.min(Math.max(1, page), current.numPages)
					: Math.max(1, page);
			return {
				...prev,
				[documentId]: { ...current, currentPage: clamped },
			};
		});
	}, [pendingJump?.tick]);

	const handleMouseDown = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			setDragging(true);

			const startX = e.clientX;
			const startWidth = width;

			const handleMouseMove = (moveEvent: MouseEvent) => {
				const delta = startX - moveEvent.clientX;
				const newWidth = Math.min(
					MAX_WIDTH,
					Math.max(MIN_WIDTH, startWidth + delta),
				);
				setWidth(newWidth);
			};

			const handleMouseUp = () => {
				setDragging(false);
				window.removeEventListener("mousemove", handleMouseMove);
				window.removeEventListener("mouseup", handleMouseUp);
			};

			window.addEventListener("mousemove", handleMouseMove);
			window.addEventListener("mouseup", handleMouseUp);
		},
		[width],
	);

	const handleAddClick = useCallback(() => {
		fileInputRef.current?.click();
	}, []);

	const handleFileChange = useCallback(
		async (e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			if (file) {
				await onUploadDocument(file);
			}
			// Reset so the same file can be re-picked if needed.
			e.target.value = "";
		},
		[onUploadDocument],
	);

	const setSelectedPage = useCallback(
		(id: string, updater: (prev: PageState) => PageState) => {
			setPageState((prev) => {
				const current = prev[id] ?? { currentPage: 1, numPages: 0 };
				return { ...prev, [id]: updater(current) };
			});
		},
		[],
	);

	const pdfPageWidth = width - 48; // match px-4 padding on each side

	// --- Empty state (no documents yet) ---------------------------------------
	if (documents.length === 0) {
		return (
			<div
				style={{ width }}
				className="flex h-full flex-shrink-0 flex-col items-center justify-center border-l border-neutral-200 bg-neutral-50"
			>
				<FileText className="mb-3 h-10 w-10 text-neutral-300" />
				<p className="text-sm text-neutral-400">No documents yet</p>
				<p className="mt-1 text-xs text-neutral-400">
					Attach a PDF from the chat below
				</p>
			</div>
		);
	}

	const currentState =
		(selectedDocument && pageState[selectedDocument.id]) ??
		({ currentPage: 1, numPages: 0 } as PageState);
	const pdfUrl = selectedDocument ? getDocumentUrl(selectedDocument.id) : null;

	return (
		<div
			ref={containerRef}
			style={{ width }}
			className="relative flex h-full flex-shrink-0 flex-col border-l border-neutral-200 bg-white"
		>
			{/* Resize handle */}
			<div
				className={`absolute top-0 left-0 z-10 h-full w-1.5 cursor-col-resize transition-colors hover:bg-neutral-300 ${
					dragging ? "bg-neutral-400" : ""
				}`}
				onMouseDown={handleMouseDown}
			/>

			{/* Tabs row */}
			<div className="flex items-stretch border-b border-neutral-200 bg-neutral-50/60 px-2 pt-2">
				{/* Scrollable document tabs */}
				<div className="flex flex-1 items-stretch gap-0.5 overflow-x-auto [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-neutral-300">
					{documents.map((doc) => {
						const isSelected = doc.id === selectedDocumentId;
						return (
							<Tooltip key={doc.id}>
								<TooltipTrigger asChild>
									<div
										className={`group relative flex max-w-[140px] cursor-pointer items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 py-1.5 text-xs transition-colors ${
											isSelected
												? "border-neutral-200 bg-white text-neutral-800"
												: "border-neutral-200 bg-neutral-100/70 text-neutral-500 hover:bg-white hover:text-neutral-700"
										}`}
										onClick={() => onSelectDocument(doc.id)}
										onKeyDown={(e) => {
											if (e.key === "Enter" || e.key === " ") {
												e.preventDefault();
												onSelectDocument(doc.id);
											}
										}}
										role="tab"
										tabIndex={0}
										aria-selected={isSelected}
									>
										<FileText className="h-3.5 w-3.5 flex-shrink-0" />
										<span className="truncate">{doc.filename}</span>
										<button
											type="button"
											aria-label={`Remove ${doc.filename}`}
											className="ml-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-sm text-neutral-400 opacity-0 transition-opacity hover:bg-neutral-200 hover:text-neutral-700 group-hover:opacity-100 focus:opacity-100"
											onClick={(e) => {
												e.stopPropagation();
												setPendingDelete(doc);
											}}
										>
											<X className="h-3 w-3" />
										</button>
									</div>
								</TooltipTrigger>
								<TooltipContent side="bottom">{doc.filename}</TooltipContent>
							</Tooltip>
						);
					})}
				</div>

				{/* Fixed Add tab */}
				<div className="ml-1 flex-shrink-0">
					<button
						type="button"
						className="flex items-center gap-1 rounded-t-md border border-b-0 border-neutral-200 bg-neutral-100/70 px-2.5 py-1.5 text-xs text-neutral-500 transition-colors hover:bg-white hover:text-neutral-700 disabled:opacity-50"
						onClick={handleAddClick}
						disabled={uploading}
						aria-label="Add another document"
					>
						{uploading ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : (
							<Plus className="h-3.5 w-3.5" />
						)}
						<span>Add</span>
					</button>
				</div>

				<input
					ref={fileInputRef}
					type="file"
					accept="application/pdf,.pdf"
					className="hidden"
					onChange={handleFileChange}
				/>
			</div>

			{/* Header (current doc info) */}
			{selectedDocument && (
				<div className="flex items-center justify-between border-b border-neutral-100 px-4 py-2.5">
					<div className="min-w-0">
						<p className="truncate text-sm font-medium text-neutral-800">
							{selectedDocument.filename}
						</p>
						<p className="text-xs text-neutral-400">
							{selectedDocument.page_count} page
							{selectedDocument.page_count !== 1 ? "s" : ""}
						</p>
					</div>
				</div>
			)}

			{/* PDF content */}
			<div className="flex-1 overflow-y-auto p-4">
				{pdfError && (
					<div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
						{pdfError}
					</div>
				)}

				{selectedDocument && pdfUrl && (
					<PDFDocument
						key={selectedDocument.id}
						file={pdfUrl}
						onLoadSuccess={({ numPages: pages }) => {
							setSelectedPage(selectedDocument.id, (prev) => ({
								// Clamp a pre-set currentPage (e.g. from a citation jump
								// that fired before the PDF finished loading) to the
								// valid [1, numPages] range.
								currentPage: Math.min(
									Math.max(1, prev.currentPage || 1),
									pages,
								),
								numPages: pages,
							}));
							setPdfLoading(false);
							setPdfError(null);
						}}
						onLoadError={(error) => {
							setPdfError(`Failed to load PDF: ${error.message}`);
							setPdfLoading(false);
						}}
						loading={
							<div className="flex items-center justify-center py-12">
								<Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
							</div>
						}
					>
						{!pdfLoading && !pdfError && currentState.numPages > 0 && (
							<Page
								pageNumber={currentState.currentPage}
								width={pdfPageWidth}
								loading={
									<div className="flex items-center justify-center py-12">
										<Loader2 className="h-5 w-5 animate-spin text-neutral-300" />
									</div>
								}
							/>
						)}
					</PDFDocument>
				)}
			</div>

			{/* Page navigation */}
			{selectedDocument && currentState.numPages > 0 && (
				<div className="flex items-center justify-center gap-3 border-t border-neutral-100 px-4 py-2.5">
					<Button
						variant="ghost"
						size="icon"
						className="h-7 w-7"
						disabled={currentState.currentPage <= 1}
						onClick={() =>
							setSelectedPage(selectedDocument.id, (p) => ({
								...p,
								currentPage: Math.max(1, p.currentPage - 1),
							}))
						}
					>
						<ChevronLeft className="h-4 w-4" />
					</Button>
					<span className="text-xs text-neutral-500">
						Page {currentState.currentPage} of {currentState.numPages}
					</span>
					<Button
						variant="ghost"
						size="icon"
						className="h-7 w-7"
						disabled={currentState.currentPage >= currentState.numPages}
						onClick={() =>
							setSelectedPage(selectedDocument.id, (p) => ({
								...p,
								currentPage: Math.min(p.numPages, p.currentPage + 1),
							}))
						}
					>
						<ChevronRight className="h-4 w-4" />
					</Button>
				</div>
			)}

			{/* Delete confirmation dialog */}
			<Dialog
				open={pendingDelete !== null}
				onOpenChange={(open) => {
					if (!open) setPendingDelete(null);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Remove document?</DialogTitle>
						<DialogDescription>
							{pendingDelete ? (
								<>
									<span className="font-medium text-neutral-800">
										{pendingDelete.filename}
									</span>{" "}
									will no longer be available for questions in this
									conversation. Previous messages that reference it will stay
									as-is.
								</>
							) : null}
						</DialogDescription>
					</DialogHeader>
					<div className="mt-2 flex justify-end gap-2">
						<Button variant="ghost" onClick={() => setPendingDelete(null)}>
							Cancel
						</Button>
						<Button
							variant="default"
							onClick={async () => {
								if (!pendingDelete) return;
								const id = pendingDelete.id;
								setPendingDelete(null);
								setPageState((prev) => {
									const next = { ...prev };
									delete next[id];
									return next;
								});
								await onDeleteDocument(id);
							}}
							className="bg-red-600 hover:bg-red-700"
						>
							Remove
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}

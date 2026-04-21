import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../lib/api";
import type { Document } from "../types";

/**
 * A request to jump the viewer to a specific page of a specific document.
 * `tick` is an always-increasing counter so repeat clicks on the same
 * (documentId, page) still re-trigger the jump effect in DocumentViewer.
 */
export interface CitationJump {
	documentId: string;
	page: number;
	tick: number;
}

export interface UseDocumentsResult {
	documents: Document[];
	selectedDocumentId: string | null;
	selectedDocument: Document | null;
	uploading: boolean;
	error: string | null;
	/**
	 * Select a document as the active tab in the viewer. If `page` is
	 * provided, the viewer will also jump to that page (used by citation
	 * chips in chat messages). Tab clicks omit `page` and preserve the
	 * per-doc page position.
	 */
	selectDocument: (id: string, page?: number) => void;
	/** The most recent citation-driven jump, or null. */
	pendingJump: CitationJump | null;
	uploadDocument: (file: File) => Promise<Document | null>;
	deleteDocument: (id: string) => Promise<void>;
	refresh: () => Promise<void>;
}

export function useDocuments(
	conversationId: string | null,
): UseDocumentsResult {
	const [documents, setDocuments] = useState<Document[]>([]);
	const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
		null,
	);
	const [uploading, setUploading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [pendingJump, setPendingJump] = useState<CitationJump | null>(null);
	const jumpTickRef = useRef(0);

	// Serialize uploads so rapid multi-file picks don't race.
	const uploadChainRef = useRef<Promise<unknown>>(Promise.resolve());

	// Keep selectedDocumentId valid whenever the document list changes.
	// Auto-select the first doc if nothing is selected; fall back if the
	// selected doc disappears.
	useEffect(() => {
		if (documents.length === 0) {
			if (selectedDocumentId !== null) setSelectedDocumentId(null);
			return;
		}
		const stillExists = documents.some((d) => d.id === selectedDocumentId);
		if (!stillExists) {
			const first = documents[0];
			if (first) setSelectedDocumentId(first.id);
		}
	}, [documents, selectedDocumentId]);

	const refresh = useCallback(async () => {
		if (!conversationId) {
			setDocuments([]);
			setSelectedDocumentId(null);
			return;
		}
		try {
			setError(null);
			const detail = await api.fetchConversation(conversationId);
			setDocuments(detail.documents ?? []);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load documents");
		}
	}, [conversationId]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const selectDocument = useCallback((id: string, page?: number) => {
		setSelectedDocumentId(id);
		if (typeof page === "number" && Number.isFinite(page) && page >= 1) {
			jumpTickRef.current += 1;
			setPendingJump({
				documentId: id,
				page: Math.floor(page),
				tick: jumpTickRef.current,
			});
		}
	}, []);

	const uploadDocument = useCallback(
		async (file: File) => {
			if (!conversationId) return null;
			// Serialize via the ref'd chain so ordering stays stable even when
			// users pick multiple files in quick succession.
			const prior = uploadChainRef.current;
			const task = (async (): Promise<Document | null> => {
				await prior.catch(() => undefined);
				try {
					setUploading(true);
					setError(null);
					const doc = await api.uploadDocument(conversationId, file);
					setDocuments((prev) => [...prev, doc]);
					// Auto-select the newly uploaded doc — users expect to see what
					// they just added.
					setSelectedDocumentId(doc.id);
					return doc;
				} catch (err) {
					setError(
						err instanceof Error ? err.message : "Failed to upload document",
					);
					return null;
				} finally {
					setUploading(false);
				}
			})();
			uploadChainRef.current = task;
			return task;
		},
		[conversationId],
	);

	const deleteDocument = useCallback(async (id: string) => {
		try {
			setError(null);
			await api.deleteDocument(id);
			setDocuments((prev) => prev.filter((d) => d.id !== id));
			// Selection fallback is handled by the effect above.
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Failed to delete document",
			);
		}
	}, []);

	const selectedDocument =
		documents.find((d) => d.id === selectedDocumentId) ?? null;

	return {
		documents,
		selectedDocumentId,
		selectedDocument,
		uploading,
		error,
		selectDocument,
		pendingJump,
		uploadDocument,
		deleteDocument,
		refresh,
	};
}

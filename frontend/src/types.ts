export interface Conversation {
	id: string;
	title: string;
	created_at: string;
	updated_at: string;
	document_count: number;
}

export type ConfidenceLevel = "high" | "medium" | "low";

export interface Message {
	id: string;
	conversation_id: string;
	role: "user" | "assistant" | "system";
	content: string;
	sources_cited: number;
	// Grounding verdict from the backend judge pass. Null when we're still
	// waiting on the judge (streaming messages between the "message" and
	// "confidence" SSE events) or when the backend decided not to judge
	// (refusal, no documents, no page-level citations, judge errored).
	confidence?: ConfidenceLevel | null;
	confidence_reason?: string | null;
	created_at: string;
}

export interface Document {
	id: string;
	conversation_id?: string;
	filename: string;
	page_count: number;
	uploaded_at: string;
}

export interface ConversationDetail {
	id: string;
	title: string;
	created_at: string;
	updated_at: string;
	documents: Document[];
}

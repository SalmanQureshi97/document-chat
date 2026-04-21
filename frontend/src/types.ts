export interface Conversation {
	id: string;
	title: string;
	created_at: string;
	updated_at: string;
	document_count: number;
}

export interface Message {
	id: string;
	conversation_id: string;
	role: "user" | "assistant" | "system";
	content: string;
	sources_cited: number;
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

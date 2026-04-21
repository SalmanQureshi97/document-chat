import { useCallback } from "react";
import { ChatSidebar } from "./components/ChatSidebar";
import { ChatWindow } from "./components/ChatWindow";
import { DocumentViewer } from "./components/DocumentViewer";
import { TooltipProvider } from "./components/ui/tooltip";
import { useConversations } from "./hooks/use-conversations";
import { useDocuments } from "./hooks/use-documents";
import { useMessages } from "./hooks/use-messages";

export default function App() {
	const {
		conversations,
		selectedId,
		loading: conversationsLoading,
		create,
		select,
		remove,
		refresh: refreshConversations,
	} = useConversations();

	const {
		messages,
		loading: messagesLoading,
		error: messagesError,
		streaming,
		streamingContent,
		send,
	} = useMessages(selectedId);

	const {
		documents,
		selectedDocumentId,
		uploading,
		selectDocument,
		uploadDocument,
		deleteDocument,
	} = useDocuments(selectedId);

	const handleSend = useCallback(
		async (content: string) => {
			await send(content);
			refreshConversations();
		},
		[send, refreshConversations],
	);

	const handleUpload = useCallback(
		async (file: File) => {
			const doc = await uploadDocument(file);
			if (doc) {
				refreshConversations();
			}
		},
		[uploadDocument, refreshConversations],
	);

	const handleDeleteDocument = useCallback(
		async (id: string) => {
			await deleteDocument(id);
			refreshConversations();
		},
		[deleteDocument, refreshConversations],
	);

	const handleCreate = useCallback(async () => {
		await create();
	}, [create]);

	return (
		<TooltipProvider delayDuration={200}>
			<div className="flex h-screen bg-neutral-50">
				<ChatSidebar
					conversations={conversations}
					selectedId={selectedId}
					loading={conversationsLoading}
					onSelect={select}
					onCreate={handleCreate}
					onDelete={remove}
				/>

				<ChatWindow
					messages={messages}
					loading={messagesLoading}
					error={messagesError}
					streaming={streaming}
					streamingContent={streamingContent}
					documents={documents}
					conversationId={selectedId}
					onSend={handleSend}
					onUpload={handleUpload}
					onSelectDocument={selectDocument}
					onCreate={handleCreate}
				/>

				{selectedId && (
					<DocumentViewer
						documents={documents}
						selectedDocumentId={selectedDocumentId}
						onSelectDocument={selectDocument}
						onDeleteDocument={handleDeleteDocument}
						onUploadDocument={uploadDocument}
						uploading={uploading}
					/>
				)}
			</div>
		</TooltipProvider>
	);
}

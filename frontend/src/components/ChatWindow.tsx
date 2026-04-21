import { Loader2, MessageSquarePlus } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Document, Message } from "../types";
import { ChatInput } from "./ChatInput";
import { EmptyState } from "./EmptyState";
import { MessageBubble, StreamingBubble } from "./MessageBubble";
import { Button } from "./ui/button";

interface ChatWindowProps {
  messages: Message[];
  loading: boolean;
  error: string | null;
  streaming: boolean;
  streamingContent: string;
  documents: Document[];
  conversationId: string | null;
  onSend: (content: string) => void;
  onUpload: (file: File) => void;
  onSelectDocument: (id: string) => void;
  onCreate: () => void;
}

export function ChatWindow({
  messages,
  loading,
  error,
  streaming,
  streamingContent,
  documents,
  conversationId,
  onSend,
  onUpload,
  onSelectDocument,
  onCreate,
}: ChatWindowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const firstDocument = documents[0];
  const hasDocument = documents.length > 0;

  // Auto-scroll to bottom when new messages arrive or during streaming
  const messagesLength = messages.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: messages and streamingContent are intentional triggers for auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messagesLength, streamingContent]);

  // No conversation selected
  if (!conversationId) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <div className="flex flex-col items-center px-4">
          <h2 className="mb-2 text-lg font-semibold text-neutral-800">
            Start a new conversation
          </h2>
          <p className="mb-8 max-w-sm text-center text-sm text-neutral-500">
            Upload leases, title reports, or other legal documents and ask
            questions across them.
          </p>
          <Button onClick={onCreate} className="gap-2">
            <MessageSquarePlus className="h-4 w-4" />
            New chat
          </Button>
        </div>
      </div>
    );
  }

  // Loading messages
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
      </div>
    );
  }

  // Empty conversation - show upload prompt
  if (messages.length === 0 && !streaming) {
    return (
      <div className="flex flex-1 flex-col bg-white">
        <div className="flex flex-1 items-center justify-center">
          {hasDocument ? (
            <div className="text-center">
              <p className="text-sm text-neutral-500">
                {documents.length === 1 && firstDocument
                  ? `${firstDocument.filename} ready. Ask a question to get started.`
                  : `${documents.length} documents loaded. Ask a question that spans any or all of them.`}
              </p>
            </div>
          ) : (
            <EmptyState onUpload={onUpload} />
          )}
        </div>
        <ChatInput
          onSend={onSend}
          onUpload={onUpload}
          disabled={streaming}
          hasDocument={hasDocument}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-white">
      {error && (
        <div className="mx-4 mt-2 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto max-w-2xl space-y-1">
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              documents={documents}
              onSelectDocument={onSelectDocument}
            />
          ))}
          {streaming && <StreamingBubble content={streamingContent} />}
        </div>
      </div>

      <ChatInput
        onSend={onSend}
        onUpload={onUpload}
        disabled={streaming}
        hasDocument={hasDocument}
      />
    </div>
  );
}

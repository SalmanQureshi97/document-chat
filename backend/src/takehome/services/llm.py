from __future__ import annotations

import re
from collections.abc import AsyncIterator
from typing import TypedDict

from pydantic_ai import Agent

from takehome.config import settings  # noqa: F401 — triggers ANTHROPIC_API_KEY export


class DocumentContext(TypedDict):
    """A document made available to the LLM for a single chat turn."""

    id: str
    filename: str
    text: str


# Soft cap on the combined extracted text we feed the model in one turn.
# Past this, we proportionally truncate each document and tell the model
# content has been trimmed. A retrieval layer is the real fix — tracked
# as a follow-up in the README.
MAX_COMBINED_DOC_CHARS = 150_000


agent = Agent(
    "anthropic:claude-haiku-4-5-20251001",
    system_prompt=(
        "You are a helpful legal document assistant for commercial real estate lawyers. "
        "You help lawyers review and understand documents during due diligence.\n\n"
        "IMPORTANT INSTRUCTIONS:\n"
        "- Answer questions based on the document content provided.\n"
        "- When referencing specific parts of a document, cite the relevant section, clause, "
        "or page, AND the document it came from by filename in square brackets, "
        "e.g. [commercial-lease-100-bishopsgate.pdf].\n"
        "- When answering a question that involves multiple documents (e.g. comparing or "
        "combining information), explicitly name every document you drew from using the same "
        "[filename] convention.\n"
        "- If the answer is not in the provided documents, say so clearly. Do not fabricate "
        "information or invent citations.\n"
        "- Be concise and precise. Lawyers value accuracy over verbosity."
    ),
)


async def generate_title(user_message: str) -> str:
    """Generate a 3-5 word conversation title from the first user message."""
    result = await agent.run(
        f"Generate a concise 3-5 word title for a conversation that starts with: '{user_message}'. "
        "Return only the title, nothing else."
    )
    title = str(result.output).strip().strip('"').strip("'")
    # Truncate if too long
    if len(title) > 100:
        title = title[:97] + "..."
    return title


def _truncate_documents(
    documents: list[DocumentContext], budget: int
) -> tuple[list[DocumentContext], bool]:
    """If total text exceeds budget, proportionally truncate each document's text.

    Returns the (possibly-truncated) documents and a flag indicating whether
    truncation happened (so the caller can emit a notice to the model).
    """
    total = sum(len(d["text"]) for d in documents)
    if total <= budget or total == 0:
        return documents, False

    ratio = budget / total
    truncated: list[DocumentContext] = []
    for d in documents:
        keep = max(1000, int(len(d["text"]) * ratio))
        text = d["text"]
        if len(text) > keep:
            text = text[:keep] + "\n\n[... document truncated due to length ...]"
        truncated.append({"id": d["id"], "filename": d["filename"], "text": text})
    return truncated, True


def _build_documents_block(documents: list[DocumentContext]) -> str:
    """Render the documents into a single XML-ish block for the prompt."""
    if not documents:
        return (
            "<documents/>\n"
            "No documents have been uploaded to this conversation yet. "
            "If the user asks about a document, let them know they need to upload one first.\n"
        )

    trimmed, was_truncated = _truncate_documents(documents, MAX_COMBINED_DOC_CHARS)

    parts: list[str] = ["<documents>"]
    if was_truncated:
        parts.append(
            "<notice>The combined document content was long and has been proportionally "
            "truncated. Answer based on what's visible; if the user's question seems to need "
            "content that may have been cut, say so.</notice>"
        )
    for i, doc in enumerate(trimmed, start=1):
        parts.append(f'<document index="{i}" filename="{doc["filename"]}">')
        parts.append(doc["text"])
        parts.append("</document>")
    parts.append("</documents>")
    return "\n".join(parts)


async def chat_with_documents(
    user_message: str,
    documents: list[DocumentContext],
    conversation_history: list[dict[str, str]],
) -> AsyncIterator[str]:
    """Stream a response to the user's message, yielding text chunks.

    Builds a prompt that includes all documents attached to the conversation
    plus the conversation history, then streams the model's response.
    """
    prompt_parts: list[str] = [_build_documents_block(documents)]

    if conversation_history:
        prompt_parts.append("\nPrevious conversation:")
        for msg in conversation_history:
            role = msg["role"]
            content = msg["content"]
            if role == "user":
                prompt_parts.append(f"User: {content}")
            elif role == "assistant":
                prompt_parts.append(f"Assistant: {content}")

    prompt_parts.append(f"\nUser: {user_message}")

    full_prompt = "\n".join(prompt_parts)

    async with agent.run_stream(full_prompt) as result:
        async for text in result.stream_text(delta=True):
            yield text


def count_sources_cited(response: str) -> int:
    """Count references to document sections, clauses, pages, or filenames."""
    patterns = [
        r"section\s+\d+",
        r"clause\s+\d+",
        r"page\s+\d+",
        r"paragraph\s+\d+",
        # Filename citations like [some-doc.pdf]
        r"\[[^\]]+\.pdf\]",
    ]
    count = 0
    for pattern in patterns:
        count += len(re.findall(pattern, response, re.IGNORECASE))
    return count

from __future__ import annotations

import re
from collections.abc import AsyncIterator
from typing import Literal, TypedDict

import structlog
from pydantic import BaseModel, Field
from pydantic_ai import Agent

from takehome.config import settings  # noqa: F401 — triggers ANTHROPIC_API_KEY export

logger = structlog.get_logger()


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


# Canonical phrase the model must emit when the answer is not grounded in the
# provided documents. The frontend treats a response matching this phrase as a
# legitimate "nothing to cite" outcome rather than as an ungrounded answer.
NO_ANSWER_PHRASE = "I can't find this in the documents you've uploaded."


agent = Agent(
    "anthropic:claude-haiku-4-5-20251001",
    system_prompt=(
        "You are a legal document assistant for commercial real estate lawyers "
        "working on due diligence. Lawyers rely on your output in advice to clients, "
        "so being *confidently wrong* is far worse than being slow or cautious.\n\n"
        "GROUNDING RULES (non-negotiable):\n"
        "- Answer ONLY from the text inside the <documents> block. Do not use outside "
        "knowledge, industry defaults, or plausible-sounding assumptions.\n"
        "- If the documents do not contain the answer, respond with exactly this "
        f'sentence and nothing else: "{NO_ANSWER_PHRASE}" You may add a brief '
        "follow-up suggesting what the user could upload or ask instead, but the "
        "canonical sentence must come first.\n"
        "- Never invent clause numbers, section headings, dates, figures, or "
        "parties. If you're unsure, say so explicitly.\n\n"
        "CITATION FORMAT:\n"
        "- Every factual claim must be followed by a citation of the form "
        "[filename.pdf p.N], where N is the number from the <page n=\"N\"> element "
        "the claim came from. Example: "
        "[commercial-lease-100-bishopsgate.pdf p.12].\n"
        "- If a claim spans pages, cite each: [lease.pdf p.3] [lease.pdf p.4].\n"
        "- When comparing or combining documents, cite every document you drew from.\n"
        "- Do NOT cite a filename unless it appears in the <documents> block.\n\n"
        "STYLE:\n"
        "- Be concise. Lawyers value accuracy and brevity over prose.\n"
        "- Prefer quoting or closely paraphrasing the document over summarising it."
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


# Matches the "--- Page N ---" header our PDF extractor emits between pages.
_PAGE_MARKER_RE = re.compile(r"^---\s*Page\s+(\d+)\s*---\s*$", re.MULTILINE)


def _split_into_pages(text: str) -> list[tuple[int, str]]:
    """Split extracted text on our "--- Page N ---" markers.

    Returns a list of (page_number, text) tuples. If no markers are present
    (edge case: older docs, extraction without page numbers), returns the
    whole blob as page 1 so the prompt still works and the model will just
    have a coarser citation.
    """
    matches = list(_PAGE_MARKER_RE.finditer(text))
    if not matches:
        stripped = text.strip()
        return [(1, stripped)] if stripped else []

    pages: list[tuple[int, str]] = []
    for i, m in enumerate(matches):
        page_num = int(m.group(1))
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        chunk = text[start:end].strip()
        if chunk:
            pages.append((page_num, chunk))
    return pages


def _build_documents_block(documents: list[DocumentContext]) -> str:
    """Render the documents into a single XML-ish block for the prompt.

    Each document is wrapped in <document index="N" filename="...">, and its
    text is split into <page n="N"> children using the "--- Page N ---"
    markers emitted by the extractor. This lets the model cite pages
    precisely ([filename p.N]) instead of gesturing at the whole doc.
    """
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
        pages = _split_into_pages(doc["text"])
        if pages:
            for page_num, page_text in pages:
                parts.append(f'<page n="{page_num}">')
                parts.append(page_text)
                parts.append("</page>")
        else:
            # No text at all (e.g. a scanned PDF we couldn't OCR). Still render
            # the document tag so the model knows it exists but has no content.
            parts.append("<page n=\"1\">[No extractable text in this document]</page>")
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
    """Count inline filename citations of the form [filename.pdf] or [filename.pdf p.N].

    We deliberately only count the bracketed filename form here — it's what the
    system prompt mandates and what the frontend renders as clickable chips.
    Loose references like "section 4.2" without a filename are not counted
    because they can't be verified against a specific document and were the
    source of "sounds authoritative but isn't grounded" complaints.
    """
    return len(re.findall(r"\[[^\]\n]+?\.pdf(?:\s+p\.\s*\d+[^\]]*)?\]", response, re.IGNORECASE))


def is_no_answer_response(response: str) -> bool:
    """True if the response is the canonical "not in the documents" refusal.

    Used so the frontend can distinguish a principled "I don't know" (good)
    from an ungrounded improvisation (bad) when neither produces citations.
    """
    return NO_ANSWER_PHRASE.lower() in response.strip().lower()


# --------------------------------------------------------------------------- #
# Judge pass: "is this answer actually grounded in what it claims to cite?"
# --------------------------------------------------------------------------- #


ConfidenceLevel = Literal["high", "medium", "low"]


class ConfidenceVerdict(BaseModel):
    """Structured output of the judge call."""

    level: ConfidenceLevel = Field(
        description=(
            "high = every factual claim is directly supported by a quoted or closely "
            "paraphrased passage within its cited pages. "
            "medium = the answer is plausible given the passages but at least one "
            "claim is inferred, loosely paraphrased, or combines passages without "
            "direct support. "
            "low = at least one claim goes beyond the passages, or specific numbers, "
            "dates, parties, or clause references don't match the cited pages."
        )
    )
    reason: str = Field(
        description=(
            "One concrete sentence (<=25 words) explaining the rating. "
            "Name the specific claim or detail that drove the rating."
        ),
        max_length=300,
    )


# The judge is intentionally a separate Agent with a tight, critical system
# prompt. Keeping it separate from the answering agent avoids the "model grades
# its own homework within the same turn" bias; the judge sees only the finished
# answer plus the cited passages, not the user's full context.
_judge_agent = Agent(
    "anthropic:claude-haiku-4-5-20251001",
    output_type=ConfidenceVerdict,
    system_prompt=(
        "You are a strict legal-document fact-checker. You will receive a user's "
        "question, an assistant's answer to that question, and the text of the "
        "passages the assistant cited. Your job: decide whether the answer is "
        "actually grounded in those passages.\n\n"
        "Rating rubric:\n"
        "- high: every factual claim in the answer appears verbatim or as a close "
        "paraphrase within its cited pages. Numbers, dates, parties, and clause "
        "references all match.\n"
        "- medium: the answer is reasonable given the passages, but at least one "
        "claim is inferred or combines passages in a way the text doesn't directly "
        "state. The lawyer should glance at the source to confirm.\n"
        "- low: at least one claim goes beyond what the passages say, OR a specific "
        "detail (a number, date, party, clause reference) doesn't match the cited "
        "text. The lawyer must verify.\n\n"
        "Be harsh. 'Confidently wrong is worse than slow' for these users. When in "
        "doubt between two levels, pick the lower one. Keep the reason concrete: "
        "name the specific claim or detail that decided the rating. Do not hedge "
        "with words like 'mostly' or 'generally' — pick a level and justify it."
    ),
)


# Matches the structured citation form [filename.pdf p.N]. We only judge
# against page-level citations; doc-level citations without a page are too
# coarse to meaningfully grade.
_CITATION_WITH_PAGE_RE = re.compile(
    r"\[([^\]\n]+?\.pdf)\s+p\.\s*(\d+)\s*(?:,\s*p\.\s*\d+\s*)*\]",
    re.IGNORECASE,
)


def extract_cited_pages(
    answer: str, documents: list[DocumentContext]
) -> list[tuple[str, int, str]]:
    """Parse [filename.pdf p.N] citations out of the answer and look up the
    corresponding page text from the available documents.

    Returns a list of (filename, page_number, page_text) tuples, deduplicated
    and in first-seen order. Filenames are matched case-insensitively and with
    optional ".pdf" tolerance, consistent with the frontend resolver.
    """
    if not answer or not documents:
        return []

    # Build a case-insensitive filename → pages map. A page is stored as text
    # keyed by its page number.
    by_filename: dict[str, dict[int, str]] = {}
    for doc in documents:
        pages = _split_into_pages(doc["text"])
        by_filename[doc["filename"].lower()] = dict(pages)
        # Also index by stem so "[lease p.3]" resolves the same as "[lease.pdf p.3]"
        stem = doc["filename"].lower().removesuffix(".pdf")
        if stem not in by_filename:
            by_filename[stem] = by_filename[doc["filename"].lower()]

    seen: set[tuple[str, int]] = set()
    out: list[tuple[str, int, str]] = []
    for match in _CITATION_WITH_PAGE_RE.finditer(answer):
        filename_raw = match.group(1).strip()
        # The regex captures the first page; pull any additional p.N tokens
        # from the full bracket contents so "[lease.pdf p.3, p.4]" yields both.
        inner = match.group(0)[1:-1]
        pages_in_cite = [int(n) for n in re.findall(r"p\.\s*(\d+)", inner, re.IGNORECASE)]

        lookup = by_filename.get(filename_raw.lower()) or by_filename.get(
            filename_raw.lower().removesuffix(".pdf")
        )
        if not lookup:
            continue

        for page_num in pages_in_cite:
            key = (filename_raw.lower(), page_num)
            if key in seen:
                continue
            page_text = lookup.get(page_num)
            if page_text is None:
                continue
            seen.add(key)
            out.append((filename_raw, page_num, page_text))

    return out


async def judge_confidence(
    user_message: str,
    answer: str,
    documents: list[DocumentContext],
) -> ConfidenceVerdict | None:
    """Run the judge pass over a finished assistant answer.

    Returns None if the answer shouldn't be judged (no documents, refusal,
    no page-level citations to check against) or if the judge call errors.
    A None return means "we won't show a confidence pill" — callers should
    NOT fabricate a default level.
    """
    if not documents:
        return None
    if is_no_answer_response(answer):
        # The canonical refusal is its own signal; no pill needed.
        return None

    cited = extract_cited_pages(answer, documents)
    if not cited:
        # Without page-level citations there's nothing specific to check
        # against; any verdict would be as ungrounded as the answer itself.
        return None

    # Budget the passages so a huge citation list doesn't blow the judge's
    # context. Keeping this generous — cited text is usually small.
    passages_xml: list[str] = ["<cited_passages>"]
    budget = 60_000
    used = 0
    for filename, page_num, page_text in cited:
        chunk = page_text
        remaining = budget - used
        if remaining <= 0:
            break
        if len(chunk) > remaining:
            chunk = chunk[:remaining] + "\n[... passage truncated ...]"
        passages_xml.append(f'<passage filename="{filename}" page="{page_num}">')
        passages_xml.append(chunk)
        passages_xml.append("</passage>")
        used += len(chunk)
    passages_xml.append("</cited_passages>")

    prompt = (
        f"<question>{user_message}</question>\n"
        f"<answer>{answer}</answer>\n"
        + "\n".join(passages_xml)
        + "\n\nRate the answer's grounding using the rubric."
    )

    try:
        result = await _judge_agent.run(prompt)
    except Exception:
        logger.exception("Judge call failed; no confidence will be recorded")
        return None

    verdict = result.output
    # Defensive: trim overly long reasons so they fit our column width.
    if len(verdict.reason) > 300:
        verdict = ConfidenceVerdict(level=verdict.level, reason=verdict.reason[:297] + "...")
    return verdict

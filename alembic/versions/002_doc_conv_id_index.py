"""Index documents.conversation_id for multi-doc lookups

Revision ID: 002_doc_conv_id_index
Revises: 001_initial
Create Date: 2026-04-21 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "002_doc_conv_id_index"
down_revision: str | None = "001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "ix_documents_conversation_id",
        "documents",
        ["conversation_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_documents_conversation_id", table_name="documents")

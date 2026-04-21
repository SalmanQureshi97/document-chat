"""Add confidence verdict fields to messages

Revision ID: 003_message_confidence
Revises: 002_doc_conv_id_index
Create Date: 2026-04-21 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "003_message_confidence"
down_revision: str | None = "002_doc_conv_id_index"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("confidence", sa.String(length=8), nullable=True),
    )
    op.add_column(
        "messages",
        sa.Column("confidence_reason", sa.String(length=300), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("messages", "confidence_reason")
    op.drop_column("messages", "confidence")

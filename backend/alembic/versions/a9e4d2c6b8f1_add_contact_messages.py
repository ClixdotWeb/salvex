"""add_contact_messages

Messages from the public Contact page (readable numbers from a sequence).

Revision ID: a9e4d2c6b8f1
Revises: f6c1a8e3b9d5
Create Date: 2026-10-24 01:00:00.000000

Deployment note: only ADDS one table and one sequence. Existing rows are not changed.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'a9e4d2c6b8f1'
down_revision: Union[str, None] = 'f6c1a8e3b9d5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('contact_messages',
    sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('number', sa.String(length=20), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('email', sa.String(length=254), nullable=False),
    sa.Column('mobile', sa.String(length=20), nullable=False),
    sa.Column('subject', sa.String(length=40), nullable=False),
    sa.Column('message', sa.String(length=3000), nullable=False),
    sa.Column('status', sa.String(length=12), nullable=False),
    sa.Column('admin_note', sa.String(length=1000), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("status IN ('new', 'in_progress', 'closed')", name='ck_contact_messages_status'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('number')
    )
    op.create_index(op.f('ix_contact_messages_status'), 'contact_messages', ['status'], unique=False)
    op.create_index(op.f('ix_contact_messages_created_at'), 'contact_messages', ['created_at'], unique=False)
    op.execute("CREATE SEQUENCE contact_message_number_seq START 1")


def downgrade() -> None:
    op.execute("DROP SEQUENCE contact_message_number_seq")
    op.drop_index(op.f('ix_contact_messages_created_at'), table_name='contact_messages')
    op.drop_index(op.f('ix_contact_messages_status'), table_name='contact_messages')
    op.drop_table('contact_messages')

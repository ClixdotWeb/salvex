"""add_order_payment_reminders

Track payment reminders sent for unpaid wins.

Revision ID: d8f3a6c1e2b5
Revises: c5d2e8f4a7b9
Create Date: 2026-10-24 15:00:00.000000

Deployment note: ADDS two columns with safe defaults. Existing rows are not changed.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd8f3a6c1e2b5'
down_revision: Union[str, None] = 'c5d2e8f4a7b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('orders', sa.Column('reminder_count', sa.Integer(), server_default='0', nullable=False))
    op.add_column('orders', sa.Column('last_reminder_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('orders', 'last_reminder_at')
    op.drop_column('orders', 'reminder_count')

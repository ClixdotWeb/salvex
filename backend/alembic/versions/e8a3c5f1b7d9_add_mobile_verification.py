"""add_mobile_verification

Buyers confirm their mobile number with a 6-digit SMS code, like the email code. Existing accounts start as
not verified and confirm the number from their dashboard before they can bid.

Revision ID: e8a3c5f1b7d9
Revises: d7f2b4c9e1a3
Create Date: 2026-10-28 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e8a3c5f1b7d9'
down_revision: Union[str, None] = 'd7f2b4c9e1a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('is_mobile_verified', sa.Boolean(), server_default='false', nullable=False))


def downgrade() -> None:
    op.drop_column('users', 'is_mobile_verified')

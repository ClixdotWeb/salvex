"""add_last_login_at

Records when each account last signed in. The column stays NULL until the first successful
sign-in, which is how the website knows to greet a brand-new user with "Welcome" instead of
"Welcome back" (client request, 2026-11-25).

Existing accounts are backfilled to their created_at rather than left NULL: they have signed in
before, so they must not be greeted as first-time users after this deploy.

Revision ID: a4d6b2f8c013
Revises: e8a3c5f1b7d9
Create Date: 2026-11-25 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a4d6b2f8c013'
down_revision: Union[str, None] = 'e8a3c5f1b7d9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True))
    # Treat every account that already exists as "has logged in before".
    op.execute("UPDATE users SET last_login_at = created_at WHERE last_login_at IS NULL")


def downgrade() -> None:
    op.drop_column('users', 'last_login_at')

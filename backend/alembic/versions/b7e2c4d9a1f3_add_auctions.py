"""add_auctions

Module 5 (Auctions): one row per auction of an approved vehicle. At most one open (scheduled or paused)
auction per vehicle. Money columns are NUMERIC(14, 2). The legacy vehicle_lots and bids tables are not
changed.

Revision ID: b7e2c4d9a1f3
Revises: 8d1f6b2a9c47
Create Date: 2026-10-22 23:00:00.000000

Deployment note: this migration only ADDS one table. Existing rows are not changed or deleted.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'b7e2c4d9a1f3'
down_revision: Union[str, None] = '8d1f6b2a9c47'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('auctions',
    sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('vehicle_id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('result', sa.String(length=10), nullable=True),
    sa.Column('starting_price', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('current_price', sa.Numeric(precision=14, scale=2), nullable=True),
    sa.Column('current_winner_id', postgresql.UUID(as_uuid=True), nullable=True),
    sa.Column('bid_count', sa.Integer(), nullable=False),
    sa.Column('starts_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('ends_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('scheduled_ends_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('paused_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('extension_enabled', sa.Boolean(), nullable=False),
    sa.Column('extension_minutes', sa.SmallInteger(), nullable=False),
    sa.Column('created_by_id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint("status IN ('scheduled', 'paused', 'closed', 'cancelled')", name='ck_auctions_status'),
    sa.CheckConstraint("result IS NULL OR result IN ('sold', 'no_sale')", name='ck_auctions_result'),
    sa.CheckConstraint("(status = 'closed') = (result IS NOT NULL)", name='ck_auctions_result_only_when_closed'),
    sa.CheckConstraint('starting_price > 0', name='ck_auctions_starting_price_positive'),
    sa.CheckConstraint('ends_at > starts_at', name='ck_auctions_ends_after_start'),
    sa.CheckConstraint('extension_minutes BETWEEN 1 AND 60', name='ck_auctions_extension_minutes'),
    sa.CheckConstraint('bid_count >= 0', name='ck_auctions_bid_count'),
    sa.CheckConstraint('current_price IS NULL OR current_price >= starting_price', name='ck_auctions_current_price'),
    sa.ForeignKeyConstraint(['vehicle_id'], ['vehicles.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['current_winner_id'], ['users.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_auctions_vehicle_id'), 'auctions', ['vehicle_id'], unique=False)
    op.create_index(op.f('ix_auctions_status'), 'auctions', ['status'], unique=False)
    op.create_index(op.f('ix_auctions_starts_at'), 'auctions', ['starts_at'], unique=False)
    op.create_index(op.f('ix_auctions_ends_at'), 'auctions', ['ends_at'], unique=False)
    op.create_index(
        'uq_auctions_one_open_per_vehicle', 'auctions', ['vehicle_id'], unique=True,
        postgresql_where=sa.text("status IN ('scheduled', 'paused')"),
    )


def downgrade() -> None:
    op.drop_index('uq_auctions_one_open_per_vehicle', table_name='auctions')
    op.drop_index(op.f('ix_auctions_ends_at'), table_name='auctions')
    op.drop_index(op.f('ix_auctions_starts_at'), table_name='auctions')
    op.drop_index(op.f('ix_auctions_status'), table_name='auctions')
    op.drop_index(op.f('ix_auctions_vehicle_id'), table_name='auctions')
    op.drop_table('auctions')

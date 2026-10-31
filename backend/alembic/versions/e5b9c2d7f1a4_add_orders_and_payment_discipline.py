"""add_orders_and_payment_discipline

Winner payment: one order per sold auction (bank transfer with UTR, confirmed by admin/finance), readable
order numbers from a sequence, and on users the count of unpaid wins and a bidding block date.

Revision ID: e5b9c2d7f1a4
Revises: d4a8f1c3e6b2
Create Date: 2026-10-23 22:00:00.000000

Deployment note: adds one table, one sequence and two columns with safe defaults. Existing rows unchanged.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'e5b9c2d7f1a4'
down_revision: Union[str, None] = 'd4a8f1c3e6b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('payment_defaults', sa.Integer(), server_default='0', nullable=False))
    op.add_column('users', sa.Column('bidding_blocked_until', sa.DateTime(timezone=True), nullable=True))
    op.execute("CREATE SEQUENCE order_number_seq START 1")

    op.create_table('orders',
    sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('number', sa.String(length=20), nullable=False),
    sa.Column('auction_id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('vehicle_id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('buyer_id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('amount', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('due_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('payment_method', sa.String(length=20), nullable=True),
    sa.Column('utr', sa.String(length=30), nullable=True),
    sa.Column('payment_submitted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('paid_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('confirmed_by_id', postgresql.UUID(as_uuid=True), nullable=True),
    sa.Column('status_reason', sa.String(length=500), nullable=True),
    sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("status IN ('awaiting_payment', 'payment_submitted', 'paid', 'defaulted', 'cancelled')", name='ck_orders_status'),
    sa.CheckConstraint('amount > 0', name='ck_orders_amount_positive'),
    sa.ForeignKeyConstraint(['auction_id'], ['auctions.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['vehicle_id'], ['vehicles.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['buyer_id'], ['users.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['confirmed_by_id'], ['users.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('number'),
    sa.UniqueConstraint('auction_id')
    )
    op.create_index(op.f('ix_orders_vehicle_id'), 'orders', ['vehicle_id'], unique=False)
    op.create_index(op.f('ix_orders_buyer_id'), 'orders', ['buyer_id'], unique=False)
    op.create_index(op.f('ix_orders_status'), 'orders', ['status'], unique=False)
    op.create_index(op.f('ix_orders_due_at'), 'orders', ['due_at'], unique=False)
    op.create_index('uq_orders_utr', 'orders', ['utr'], unique=True, postgresql_where=sa.text('utr IS NOT NULL'))


def downgrade() -> None:
    op.drop_index('uq_orders_utr', table_name='orders')
    op.drop_index(op.f('ix_orders_due_at'), table_name='orders')
    op.drop_index(op.f('ix_orders_status'), table_name='orders')
    op.drop_index(op.f('ix_orders_buyer_id'), table_name='orders')
    op.drop_index(op.f('ix_orders_vehicle_id'), table_name='orders')
    op.drop_table('orders')
    op.execute("DROP SEQUENCE order_number_seq")
    op.drop_column('users', 'bidding_blocked_until')
    op.drop_column('users', 'payment_defaults')

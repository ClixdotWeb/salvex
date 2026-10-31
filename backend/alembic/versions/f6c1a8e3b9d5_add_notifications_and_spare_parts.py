"""add_notifications_and_spare_parts

In-app notifications with an email outbox; fixed-price spare parts and part requests (with readable
request numbers from a sequence).

Revision ID: f6c1a8e3b9d5
Revises: e5b9c2d7f1a4
Create Date: 2026-10-23 23:30:00.000000

Deployment note: only ADDS three tables and one sequence. Existing rows are not changed.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'f6c1a8e3b9d5'
down_revision: Union[str, None] = 'e5b9c2d7f1a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('notifications',
    sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('kind', sa.String(length=40), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('body', sa.String(length=1000), nullable=False),
    sa.Column('link', sa.String(length=300), nullable=True),
    sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('email_status', sa.String(length=10), nullable=False),
    sa.Column('email_attempts', sa.SmallInteger(), nullable=False),
    sa.Column('emailed_at', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint("email_status IN ('pending', 'sent', 'failed', 'skipped')", name='ck_notifications_email_status'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_notifications_user_created', 'notifications', ['user_id', 'created_at'], unique=False)
    op.create_index('ix_notifications_email_pending', 'notifications', ['email_status', 'created_at'], unique=False)

    op.create_table('spare_parts',
    sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('make', sa.String(length=60), nullable=False),
    sa.Column('model', sa.String(length=60), nullable=True),
    sa.Column('year_from', sa.SmallInteger(), nullable=True),
    sa.Column('year_to', sa.SmallInteger(), nullable=True),
    sa.Column('condition', sa.String(length=10), nullable=False),
    sa.Column('price', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('stock', sa.Integer(), nullable=False),
    sa.Column('description', sa.String(length=1000), nullable=False),
    sa.Column('photo_key', sa.String(length=100), nullable=True),
    sa.Column('photo_type', sa.String(length=50), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint('price > 0', name='ck_spare_parts_price_positive'),
    sa.CheckConstraint('stock >= 0', name='ck_spare_parts_stock_non_negative'),
    sa.CheckConstraint("condition IN ('new', 'used')", name='ck_spare_parts_condition'),
    sa.CheckConstraint('year_to IS NULL OR year_from IS NULL OR year_to >= year_from', name='ck_spare_parts_years'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_spare_parts_name'), 'spare_parts', ['name'], unique=False)
    op.create_index(op.f('ix_spare_parts_make'), 'spare_parts', ['make'], unique=False)
    op.create_index(op.f('ix_spare_parts_model'), 'spare_parts', ['model'], unique=False)

    op.execute("CREATE SEQUENCE part_request_number_seq START 1")
    op.create_table('part_requests',
    sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('number', sa.String(length=20), nullable=False),
    sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('part_id', postgresql.UUID(as_uuid=True), nullable=True),
    sa.Column('vehicle_make', sa.String(length=60), nullable=False),
    sa.Column('vehicle_model', sa.String(length=60), nullable=False),
    sa.Column('vehicle_year', sa.SmallInteger(), nullable=True),
    sa.Column('part_name', sa.String(length=120), nullable=False),
    sa.Column('details', sa.String(length=1000), nullable=False),
    sa.Column('status', sa.String(length=12), nullable=False),
    sa.Column('admin_reply', sa.String(length=1000), nullable=True),
    sa.Column('quoted_price', sa.Numeric(precision=12, scale=2), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("status IN ('new', 'checking', 'quoted', 'ready', 'closed', 'cancelled')", name='ck_part_requests_status'),
    sa.CheckConstraint('quoted_price IS NULL OR quoted_price > 0', name='ck_part_requests_price_positive'),
    sa.ForeignKeyConstraint(['part_id'], ['spare_parts.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('number')
    )
    op.create_index(op.f('ix_part_requests_user_id'), 'part_requests', ['user_id'], unique=False)
    op.create_index(op.f('ix_part_requests_status'), 'part_requests', ['status'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_part_requests_status'), table_name='part_requests')
    op.drop_index(op.f('ix_part_requests_user_id'), table_name='part_requests')
    op.drop_table('part_requests')
    op.execute("DROP SEQUENCE part_request_number_seq")
    op.drop_index(op.f('ix_spare_parts_model'), table_name='spare_parts')
    op.drop_index(op.f('ix_spare_parts_make'), table_name='spare_parts')
    op.drop_index(op.f('ix_spare_parts_name'), table_name='spare_parts')
    op.drop_table('spare_parts')
    op.drop_index('ix_notifications_email_pending', table_name='notifications')
    op.drop_index('ix_notifications_user_created', table_name='notifications')
    op.drop_table('notifications')

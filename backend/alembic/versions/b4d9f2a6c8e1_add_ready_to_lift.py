"""add_ready_to_lift

Ready to Lift: vehicles.listing_type (auction | ready_to_lift), KM driven, Superdari, sold_at (a Ready to Lift
vehicle marked sold leaves the public list), and the vehicle_enquiries table ("I'm interested").

Revision ID: b4d9f2a6c8e1
Revises: a2c8e5f7b1d3
Create Date: 2026-10-25 11:00:00.000000

Deployment note: adds columns (existing vehicles become "auction") and one table with a sequence.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'b4d9f2a6c8e1'
down_revision: Union[str, None] = 'a2c8e5f7b1d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('vehicles', sa.Column('listing_type', sa.String(length=20), server_default='auction', nullable=False))
    op.add_column('vehicles', sa.Column('km_driven', sa.Integer(), nullable=True))
    op.add_column('vehicles', sa.Column('superdari', sa.Boolean(), nullable=True))
    op.add_column('vehicles', sa.Column('sold_at', sa.DateTime(timezone=True), nullable=True))
    op.create_check_constraint('ck_vehicles_listing_type', 'vehicles', "listing_type IN ('auction', 'ready_to_lift')")
    op.create_check_constraint('ck_vehicles_km_driven', 'vehicles', 'km_driven IS NULL OR km_driven >= 0')
    op.create_index(op.f('ix_vehicles_listing_type'), 'vehicles', ['listing_type'], unique=False)

    op.create_table('vehicle_enquiries',
    sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('number', sa.String(length=20), nullable=False),
    sa.Column('vehicle_id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('status', sa.String(length=12), nullable=False),
    sa.Column('admin_note', sa.String(length=1000), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("status IN ('new', 'contacted', 'closed')", name='ck_vehicle_enquiries_status'),
    sa.ForeignKeyConstraint(['vehicle_id'], ['vehicles.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('number'),
    sa.UniqueConstraint('vehicle_id', 'user_id', name='uq_vehicle_enquiries_vehicle_user')
    )
    op.create_index(op.f('ix_vehicle_enquiries_vehicle_id'), 'vehicle_enquiries', ['vehicle_id'], unique=False)
    op.create_index(op.f('ix_vehicle_enquiries_user_id'), 'vehicle_enquiries', ['user_id'], unique=False)
    op.create_index(op.f('ix_vehicle_enquiries_status'), 'vehicle_enquiries', ['status'], unique=False)
    op.create_index(op.f('ix_vehicle_enquiries_created_at'), 'vehicle_enquiries', ['created_at'], unique=False)
    op.execute("CREATE SEQUENCE enquiry_number_seq START 1")


def downgrade() -> None:
    op.execute("DROP SEQUENCE enquiry_number_seq")
    op.drop_index(op.f('ix_vehicle_enquiries_created_at'), table_name='vehicle_enquiries')
    op.drop_index(op.f('ix_vehicle_enquiries_status'), table_name='vehicle_enquiries')
    op.drop_index(op.f('ix_vehicle_enquiries_user_id'), table_name='vehicle_enquiries')
    op.drop_index(op.f('ix_vehicle_enquiries_vehicle_id'), table_name='vehicle_enquiries')
    op.drop_table('vehicle_enquiries')
    op.drop_index(op.f('ix_vehicles_listing_type'), table_name='vehicles')
    op.drop_constraint('ck_vehicles_km_driven', 'vehicles', type_='check')
    op.drop_constraint('ck_vehicles_listing_type', 'vehicles', type_='check')
    op.drop_column('vehicles', 'sold_at')
    op.drop_column('vehicles', 'superdari')
    op.drop_column('vehicles', 'km_driven')
    op.drop_column('vehicles', 'listing_type')

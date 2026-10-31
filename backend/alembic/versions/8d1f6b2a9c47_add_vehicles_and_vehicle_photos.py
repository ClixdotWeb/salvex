"""add_vehicles_and_vehicle_photos

Module 4 (Vehicles):
  * vehicles: the company's vehicle fields, review status, and who added it. One ACTIVE vehicle per
    registration number (partial unique index); a rejected vehicle can be added again.
  * vehicle_photos: metadata of each photo (the file itself is in storage, never here).
The legacy vehicle_lots and bids tables are not changed.

Revision ID: 8d1f6b2a9c47
Revises: 5c3e9a7b1f42
Create Date: 2026-10-22 21:00:00.000000

Deployment note: this migration only ADDS two tables. Existing rows are not changed or deleted.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '8d1f6b2a9c47'
down_revision: Union[str, None] = '5c3e9a7b1f42'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('vehicles',
    sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('owner_id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('registration_number', sa.String(length=15), nullable=False),
    sa.Column('claim_number', sa.String(length=50), nullable=False),
    sa.Column('make', sa.String(length=60), nullable=False),
    sa.Column('model', sa.String(length=60), nullable=False),
    sa.Column('variant', sa.String(length=80), nullable=False),
    sa.Column('manufacturing_year', sa.SmallInteger(), nullable=False),
    sa.Column('registration_year', sa.SmallInteger(), nullable=False),
    sa.Column('fuel_type', sa.String(length=20), nullable=False),
    sa.Column('transmission', sa.String(length=20), nullable=False),
    sa.Column('number_of_owners', sa.SmallInteger(), nullable=False),
    sa.Column('damage_type', sa.String(length=30), nullable=False),
    sa.Column('location', sa.String(length=120), nullable=False),
    sa.Column('rc_status', sa.String(length=20), nullable=False),
    sa.Column('registration_type', sa.String(length=20), nullable=False),
    sa.Column('hypothecation_status', sa.String(length=20), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('submitted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('reviewed_by_id', postgresql.UUID(as_uuid=True), nullable=True),
    sa.Column('review_reason', sa.String(length=1000), nullable=True),
    sa.CheckConstraint(
        "status IN ('draft', 'submitted', 'changes_requested', 'approved', 'rejected')", name='ck_vehicles_status'),
    sa.CheckConstraint('registration_year >= manufacturing_year', name='ck_vehicles_registration_after_manufacture'),
    sa.CheckConstraint('number_of_owners >= 0', name='ck_vehicles_owners_non_negative'),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['reviewed_by_id'], ['users.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_vehicles_owner_id'), 'vehicles', ['owner_id'], unique=False)
    op.create_index(op.f('ix_vehicles_status'), 'vehicles', ['status'], unique=False)
    op.create_index(op.f('ix_vehicles_registration_number'), 'vehicles', ['registration_number'], unique=False)
    op.create_index(op.f('ix_vehicles_make'), 'vehicles', ['make'], unique=False)
    op.create_index(op.f('ix_vehicles_model'), 'vehicles', ['model'], unique=False)
    op.create_index(op.f('ix_vehicles_location'), 'vehicles', ['location'], unique=False)
    op.create_index(
        'uq_vehicles_active_registration', 'vehicles', ['registration_number'], unique=True,
        postgresql_where=sa.text("status IN ('draft', 'submitted', 'changes_requested', 'approved')"),
    )

    op.create_table('vehicle_photos',
    sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('vehicle_id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('storage_key', sa.String(length=100), nullable=False),
    sa.Column('content_type', sa.String(length=50), nullable=False),
    sa.Column('size_bytes', sa.Integer(), nullable=False),
    sa.Column('sha256', sa.String(length=64), nullable=False),
    sa.Column('uploaded_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("content_type IN ('image/jpeg', 'image/png')", name='ck_vehicle_photos_content_type'),
    sa.CheckConstraint('size_bytes > 0', name='ck_vehicle_photos_size_positive'),
    sa.ForeignKeyConstraint(['vehicle_id'], ['vehicles.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('storage_key')
    )
    op.create_index(op.f('ix_vehicle_photos_vehicle_id'), 'vehicle_photos', ['vehicle_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_vehicle_photos_vehicle_id'), table_name='vehicle_photos')
    op.drop_table('vehicle_photos')
    op.drop_index('uq_vehicles_active_registration', table_name='vehicles')
    op.drop_index(op.f('ix_vehicles_location'), table_name='vehicles')
    op.drop_index(op.f('ix_vehicles_model'), table_name='vehicles')
    op.drop_index(op.f('ix_vehicles_make'), table_name='vehicles')
    op.drop_index(op.f('ix_vehicles_registration_number'), table_name='vehicles')
    op.drop_index(op.f('ix_vehicles_status'), table_name='vehicles')
    op.drop_index(op.f('ix_vehicles_owner_id'), table_name='vehicles')
    op.drop_table('vehicles')

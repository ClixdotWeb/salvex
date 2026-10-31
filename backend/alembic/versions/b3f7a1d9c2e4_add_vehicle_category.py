"""add_vehicle_category

Vehicle category for separate auction listings: insurance, bank_nbfc, used_vehicle.

Revision ID: b3f7a1d9c2e4
Revises: a9e4d2c6b8f1
Create Date: 2026-10-24 02:00:00.000000

Deployment note: ADDS one column with a default; existing vehicles become "used_vehicle".
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b3f7a1d9c2e4'
down_revision: Union[str, None] = 'a9e4d2c6b8f1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('vehicles', sa.Column('category', sa.String(length=20), server_default='used_vehicle', nullable=False))
    op.create_index(op.f('ix_vehicles_category'), 'vehicles', ['category'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_vehicles_category'), table_name='vehicles')
    op.drop_column('vehicles', 'category')

"""add_vehicle_damage_other

Free-text damage description, used when the damage type is "Other".

Revision ID: c5d2e8f4a7b9
Revises: b3f7a1d9c2e4
Create Date: 2026-10-24 14:00:00.000000

Deployment note: ADDS one nullable column. Existing rows are not changed.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c5d2e8f4a7b9'
down_revision: Union[str, None] = 'b3f7a1d9c2e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('vehicles', sa.Column('damage_other', sa.String(length=120), nullable=True))


def downgrade() -> None:
    op.drop_column('vehicles', 'damage_other')

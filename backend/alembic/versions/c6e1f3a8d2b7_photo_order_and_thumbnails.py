"""photo_order_and_thumbnails

Vehicle photos get an order (position; the first photo is the cover, the admin can reorder) and an optional
small thumbnail (made in the browser at upload time) used by lists and cards.

Revision ID: c6e1f3a8d2b7
Revises: b4d9f2a6c8e1
Create Date: 2026-10-25 18:00:00.000000

Deployment note: adds three columns; existing photos are numbered in upload order and have no thumbnail
(the full photo is served instead).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c6e1f3a8d2b7'
down_revision: Union[str, None] = 'b4d9f2a6c8e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('vehicle_photos', sa.Column('position', sa.Integer(), server_default='0', nullable=False))
    op.add_column('vehicle_photos', sa.Column('thumb_key', sa.String(length=100), nullable=True))
    op.add_column('vehicle_photos', sa.Column('thumb_sha256', sa.String(length=64), nullable=True))
    op.create_unique_constraint('uq_vehicle_photos_thumb_key', 'vehicle_photos', ['thumb_key'])
    op.execute("""
        UPDATE vehicle_photos p SET position = r.n
        FROM (SELECT id, row_number() OVER (PARTITION BY vehicle_id ORDER BY uploaded_at, id) - 1 AS n
              FROM vehicle_photos) r
        WHERE p.id = r.id
    """)


def downgrade() -> None:
    op.drop_constraint('uq_vehicle_photos_thumb_key', 'vehicle_photos', type_='unique')
    op.drop_column('vehicle_photos', 'thumb_sha256')
    op.drop_column('vehicle_photos', 'thumb_key')
    op.drop_column('vehicle_photos', 'position')

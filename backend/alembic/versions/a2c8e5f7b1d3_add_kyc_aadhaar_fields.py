"""add_kyc_aadhaar_fields

Aadhaar number on KYC submissions: last 4 digits and a keyed hash only (the full number is never stored).

Revision ID: a2c8e5f7b1d3
Revises: f1a7c3e9d2b6
Create Date: 2026-10-25 09:00:00.000000

Deployment note: ADDS two nullable columns and an index.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a2c8e5f7b1d3'
down_revision: Union[str, None] = 'f1a7c3e9d2b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('kyc_submissions', sa.Column('aadhaar_last4', sa.String(length=4), nullable=True))
    op.add_column('kyc_submissions', sa.Column('aadhaar_hash', sa.String(length=64), nullable=True))
    op.create_index(op.f('ix_kyc_submissions_aadhaar_hash'), 'kyc_submissions', ['aadhaar_hash'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_kyc_submissions_aadhaar_hash'), table_name='kyc_submissions')
    op.drop_column('kyc_submissions', 'aadhaar_hash')
    op.drop_column('kyc_submissions', 'aadhaar_last4')

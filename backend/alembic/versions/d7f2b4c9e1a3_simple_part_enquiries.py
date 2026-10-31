"""simple_part_enquiries

Spare part requests become simple enquiries, like the Ready to Lift ones: the team calls the customer, so the
statuses are new / contacted / closed, the customer's phone is stored on the enquiry, and the admin keeps an
internal note. Old statuses: checking / quoted / ready -> contacted, cancelled -> closed. The old reply text is
kept as the internal note; quoted_price stays in the table (history) but is no longer used.

Revision ID: d7f2b4c9e1a3
Revises: c6e1f3a8d2b7
Create Date: 2026-10-26 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd7f2b4c9e1a3'
down_revision: Union[str, None] = 'c6e1f3a8d2b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint('ck_part_requests_status', 'part_requests', type_='check')
    op.execute("UPDATE part_requests SET status = 'contacted' WHERE status IN ('checking', 'quoted', 'ready')")
    op.execute("UPDATE part_requests SET status = 'closed' WHERE status = 'cancelled'")
    op.create_check_constraint('ck_part_requests_status', 'part_requests', "status IN ('new', 'contacted', 'closed')")
    op.alter_column('part_requests', 'admin_reply', new_column_name='admin_note')
    op.add_column('part_requests', sa.Column('contact_phone', sa.String(length=20), server_default='', nullable=False))
    # earlier requests: the customer's profile phone
    op.execute("UPDATE part_requests p SET contact_phone = left(coalesce(u.mobile, ''), 20) FROM users u WHERE u.id = p.user_id")


def downgrade() -> None:
    op.drop_column('part_requests', 'contact_phone')
    op.alter_column('part_requests', 'admin_note', new_column_name='admin_reply')
    op.drop_constraint('ck_part_requests_status', 'part_requests', type_='check')
    op.execute("UPDATE part_requests SET status = 'checking' WHERE status = 'contacted'")
    op.create_check_constraint('ck_part_requests_status', 'part_requests',
                               "status IN ('new', 'checking', 'quoted', 'ready', 'closed', 'cancelled')")

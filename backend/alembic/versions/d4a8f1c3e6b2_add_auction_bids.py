"""add_auction_bids

Module 6 (Bidding): append-only bids on auctions. A trigger rejects UPDATE, DELETE and TRUNCATE.
Amounts are unique per auction (every accepted bid is higher than the previous one). A repeated request
with the same idempotency key from the same bidder cannot create a second bid.

Revision ID: d4a8f1c3e6b2
Revises: b7e2c4d9a1f3
Create Date: 2026-10-23 08:00:00.000000

Deployment note: this migration only ADDS one table. Existing rows are not changed or deleted.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'd4a8f1c3e6b2'
down_revision: Union[str, None] = 'b7e2c4d9a1f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('auction_bids',
    sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('auction_id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('bidder_id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('amount', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('idempotency_key', sa.String(length=64), nullable=True),
    sa.CheckConstraint('amount > 0', name='ck_auction_bids_amount_positive'),
    sa.ForeignKeyConstraint(['auction_id'], ['auctions.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['bidder_id'], ['users.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('auction_id', 'amount', name='uq_auction_bids_auction_amount')
    )
    op.create_index(op.f('ix_auction_bids_auction_id'), 'auction_bids', ['auction_id'], unique=False)
    op.create_index(op.f('ix_auction_bids_bidder_id'), 'auction_bids', ['bidder_id'], unique=False)
    op.create_index('ix_auction_bids_auction_created', 'auction_bids', ['auction_id', 'created_at'], unique=False)
    op.create_index(
        'uq_auction_bids_bidder_idempotency_key', 'auction_bids', ['bidder_id', 'idempotency_key'], unique=True,
        postgresql_where=sa.text('idempotency_key IS NOT NULL'),
    )

    op.execute("""
        CREATE FUNCTION auction_bids_reject_change() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'auction_bids is append-only: % is not allowed', TG_OP;
        END;
        $$ LANGUAGE plpgsql
    """)
    op.execute("""
        CREATE TRIGGER auction_bids_no_update_delete
        BEFORE UPDATE OR DELETE ON auction_bids
        FOR EACH ROW EXECUTE FUNCTION auction_bids_reject_change()
    """)
    op.execute("""
        CREATE TRIGGER auction_bids_no_truncate
        BEFORE TRUNCATE ON auction_bids
        FOR EACH STATEMENT EXECUTE FUNCTION auction_bids_reject_change()
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER auction_bids_no_truncate ON auction_bids")
    op.execute("DROP TRIGGER auction_bids_no_update_delete ON auction_bids")
    op.execute("DROP FUNCTION auction_bids_reject_change()")
    op.drop_index('uq_auction_bids_bidder_idempotency_key', table_name='auction_bids')
    op.drop_index('ix_auction_bids_auction_created', table_name='auction_bids')
    op.drop_index(op.f('ix_auction_bids_bidder_id'), table_name='auction_bids')
    op.drop_index(op.f('ix_auction_bids_auction_id'), table_name='auction_bids')
    op.drop_table('auction_bids')

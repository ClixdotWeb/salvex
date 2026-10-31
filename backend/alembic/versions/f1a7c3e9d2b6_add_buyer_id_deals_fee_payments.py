"""add_buyer_id_deals_fee_payments

Buyer ID for every user (users.buyer_number, shown as SLX-000123; existing users numbered in sign-up order),
deal fields on orders (approved amount / date, service fee) and the append-only fee_payments table.

Revision ID: f1a7c3e9d2b6
Revises: d8f3a6c1e2b5
Create Date: 2026-10-24 18:00:00.000000

Deployment note: adds columns and one table; existing users get numbers 1, 2, 3 ... by sign-up date.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'f1a7c3e9d2b6'
down_revision: Union[str, None] = 'd8f3a6c1e2b5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ---- Buyer ID
    op.execute("CREATE SEQUENCE buyer_number_seq START 1")
    op.add_column('users', sa.Column('buyer_number', sa.Integer(), nullable=True))
    op.execute("""
        UPDATE users SET buyer_number = numbered.n
        FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS n FROM users) AS numbered
        WHERE users.id = numbered.id
    """)
    op.execute("SELECT setval('buyer_number_seq', COALESCE((SELECT MAX(buyer_number) FROM users), 0) + 1, false)")
    op.alter_column('users', 'buyer_number', nullable=False, server_default=sa.text("nextval('buyer_number_seq')"))
    op.create_index('uq_users_buyer_number', 'users', ['buyer_number'], unique=True)

    # ---- deal fields on the order
    op.add_column('orders', sa.Column('approved_amount', sa.Numeric(14, 2), nullable=True))
    op.add_column('orders', sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('orders', sa.Column('service_fee', sa.Numeric(12, 2), nullable=True))
    op.execute("UPDATE orders SET approved_amount = amount, approved_at = created_at")
    op.create_check_constraint('ck_orders_approved_amount_positive', 'orders', 'approved_amount IS NULL OR approved_amount > 0')
    op.create_check_constraint('ck_orders_service_fee_not_negative', 'orders', 'service_fee IS NULL OR service_fee >= 0')

    # ---- fee payments (append-only)
    op.create_table('fee_payments',
    sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('order_id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('amount', sa.Numeric(12, 2), nullable=False),
    sa.Column('received_on', sa.Date(), nullable=False),
    sa.Column('reference', sa.String(length=60), nullable=False),
    sa.Column('note', sa.String(length=300), nullable=True),
    sa.Column('created_by_id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint('amount <> 0', name='ck_fee_payments_amount_not_zero'),
    sa.ForeignKeyConstraint(['order_id'], ['orders.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_fee_payments_order_id'), 'fee_payments', ['order_id'], unique=False)
    op.execute("""
        CREATE FUNCTION fee_payments_reject_change() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'fee_payments is append-only: % is not allowed', TG_OP;
        END;
        $$ LANGUAGE plpgsql
    """)
    op.execute("""
        CREATE TRIGGER fee_payments_no_update_delete
        BEFORE UPDATE OR DELETE ON fee_payments
        FOR EACH ROW EXECUTE FUNCTION fee_payments_reject_change()
    """)
    op.execute("""
        CREATE TRIGGER fee_payments_no_truncate
        BEFORE TRUNCATE ON fee_payments
        FOR EACH STATEMENT EXECUTE FUNCTION fee_payments_reject_change()
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER fee_payments_no_truncate ON fee_payments")
    op.execute("DROP TRIGGER fee_payments_no_update_delete ON fee_payments")
    op.execute("DROP FUNCTION fee_payments_reject_change()")
    op.drop_index(op.f('ix_fee_payments_order_id'), table_name='fee_payments')
    op.drop_table('fee_payments')
    op.drop_constraint('ck_orders_service_fee_not_negative', 'orders', type_='check')
    op.drop_constraint('ck_orders_approved_amount_positive', 'orders', type_='check')
    op.drop_column('orders', 'service_fee')
    op.drop_column('orders', 'approved_at')
    op.drop_column('orders', 'approved_amount')
    op.drop_index('uq_users_buyer_number', table_name='users')
    op.drop_column('users', 'buyer_number')
    op.execute("DROP SEQUENCE buyer_number_seq")

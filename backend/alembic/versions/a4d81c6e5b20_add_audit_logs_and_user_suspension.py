"""add_audit_logs_and_user_suspension

Module 1 foundation:
  * audit_logs: append-only record of sensitive administrative actions (a trigger rejects UPDATE,
    DELETE and TRUNCATE, so history cannot be edited or erased through the application).
  * users.suspended_at / suspension_reason / suspended_by_id: who suspended an account, why and when.

Revision ID: a4d81c6e5b20
Revises: 7b2f4a9c1d3e
Create Date: 2026-10-22 14:00:00.000000

Deployment note: this migration only ADDS a table and three nullable columns. Existing rows are not
changed or deleted. Take a backup before running it on any hosted database.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'a4d81c6e5b20'
down_revision: Union[str, None] = '7b2f4a9c1d3e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('audit_logs',
    sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('actor_id', postgresql.UUID(as_uuid=True), nullable=True),
    sa.Column('actor_role', sa.String(length=20), nullable=False),
    sa.Column('action', sa.String(length=64), nullable=False),
    sa.Column('target_type', sa.String(length=50), nullable=False),
    sa.Column('target_id', sa.String(length=64), nullable=True),
    sa.Column('details', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    sa.ForeignKeyConstraint(['actor_id'], ['users.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_audit_logs_action'), 'audit_logs', ['action'], unique=False)
    op.create_index(op.f('ix_audit_logs_actor_id'), 'audit_logs', ['actor_id'], unique=False)
    op.create_index(op.f('ix_audit_logs_created_at'), 'audit_logs', ['created_at'], unique=False)
    op.create_index('ix_audit_logs_target', 'audit_logs', ['target_type', 'target_id'], unique=False)

    # Append-only: refuse to change or remove history.
    op.execute("""
        CREATE FUNCTION audit_logs_reject_change() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'audit_logs is append-only: % is not allowed', TG_OP;
        END;
        $$ LANGUAGE plpgsql
    """)
    op.execute("""
        CREATE TRIGGER audit_logs_no_update_delete
        BEFORE UPDATE OR DELETE ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION audit_logs_reject_change()
    """)
    op.execute("""
        CREATE TRIGGER audit_logs_no_truncate
        BEFORE TRUNCATE ON audit_logs
        FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_reject_change()
    """)

    op.add_column('users', sa.Column('suspended_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('suspension_reason', sa.String(length=500), nullable=True))
    op.add_column('users', sa.Column('suspended_by_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        'fk_users_suspended_by_id_users', 'users', 'users', ['suspended_by_id'], ['id'], ondelete='SET NULL'
    )


def downgrade() -> None:
    op.drop_constraint('fk_users_suspended_by_id_users', 'users', type_='foreignkey')
    op.drop_column('users', 'suspended_by_id')
    op.drop_column('users', 'suspension_reason')
    op.drop_column('users', 'suspended_at')

    op.execute("DROP TRIGGER audit_logs_no_truncate ON audit_logs")
    op.execute("DROP TRIGGER audit_logs_no_update_delete ON audit_logs")
    op.execute("DROP FUNCTION audit_logs_reject_change()")
    op.drop_index('ix_audit_logs_target', table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_created_at'), table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_actor_id'), table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_action'), table_name='audit_logs')
    op.drop_table('audit_logs')

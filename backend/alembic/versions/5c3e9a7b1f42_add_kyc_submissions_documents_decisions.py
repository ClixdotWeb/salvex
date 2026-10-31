"""add_kyc_submissions_documents_decisions

Module 3 (KYC):
  * kyc_submissions: one verification attempt per row; at most one open (draft / submitted /
    changes_requested) per user, enforced by a partial unique index.
  * kyc_documents: metadata of each uploaded file (the file itself is in private storage, never here).
  * kyc_decisions: append-only reviewer decisions (a trigger rejects UPDATE, DELETE and TRUNCATE).

Revision ID: 5c3e9a7b1f42
Revises: a4d81c6e5b20
Create Date: 2026-10-22 18:00:00.000000

Deployment note: this migration only ADDS three tables. Existing rows are not changed or deleted.
Take a backup before running it on any hosted database.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '5c3e9a7b1f42'
down_revision: Union[str, None] = 'a4d81c6e5b20'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('kyc_submissions',
    sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('submitted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint(
        "status IN ('draft', 'submitted', 'changes_requested', 'approved', 'rejected')",
        name='ck_kyc_submissions_status'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_kyc_submissions_user_id'), 'kyc_submissions', ['user_id'], unique=False)
    op.create_index(op.f('ix_kyc_submissions_status'), 'kyc_submissions', ['status'], unique=False)
    op.create_index(
        'uq_kyc_submissions_one_open_per_user', 'kyc_submissions', ['user_id'], unique=True,
        postgresql_where=sa.text("status IN ('draft', 'submitted', 'changes_requested')"),
    )

    op.create_table('kyc_documents',
    sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('submission_id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('document_type', sa.String(length=40), nullable=False),
    sa.Column('storage_key', sa.String(length=100), nullable=False),
    sa.Column('content_type', sa.String(length=50), nullable=False),
    sa.Column('size_bytes', sa.Integer(), nullable=False),
    sa.Column('sha256', sa.String(length=64), nullable=False),
    sa.Column('uploaded_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('withdrawn_at', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint(
        "content_type IN ('application/pdf', 'image/jpeg', 'image/png')", name='ck_kyc_documents_content_type'),
    sa.CheckConstraint('size_bytes > 0', name='ck_kyc_documents_size_positive'),
    sa.ForeignKeyConstraint(['submission_id'], ['kyc_submissions.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('storage_key')
    )
    op.create_index(op.f('ix_kyc_documents_submission_id'), 'kyc_documents', ['submission_id'], unique=False)
    op.create_index(op.f('ix_kyc_documents_user_id'), 'kyc_documents', ['user_id'], unique=False)

    op.create_table('kyc_decisions',
    sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('submission_id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('reviewer_id', postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('decision', sa.String(length=20), nullable=False),
    sa.Column('reason', sa.String(length=1000), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint(
        "decision IN ('approved', 'rejected', 'changes_requested')", name='ck_kyc_decisions_decision'),
    sa.ForeignKeyConstraint(['reviewer_id'], ['users.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['submission_id'], ['kyc_submissions.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_kyc_decisions_submission_id'), 'kyc_decisions', ['submission_id'], unique=False)
    op.create_index(op.f('ix_kyc_decisions_reviewer_id'), 'kyc_decisions', ['reviewer_id'], unique=False)

    # Append-only decisions: refuse to change or remove them.
    op.execute("""
        CREATE FUNCTION kyc_decisions_reject_change() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'kyc_decisions is append-only: % is not allowed', TG_OP;
        END;
        $$ LANGUAGE plpgsql
    """)
    op.execute("""
        CREATE TRIGGER kyc_decisions_no_update_delete
        BEFORE UPDATE OR DELETE ON kyc_decisions
        FOR EACH ROW EXECUTE FUNCTION kyc_decisions_reject_change()
    """)
    op.execute("""
        CREATE TRIGGER kyc_decisions_no_truncate
        BEFORE TRUNCATE ON kyc_decisions
        FOR EACH STATEMENT EXECUTE FUNCTION kyc_decisions_reject_change()
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER kyc_decisions_no_truncate ON kyc_decisions")
    op.execute("DROP TRIGGER kyc_decisions_no_update_delete ON kyc_decisions")
    op.execute("DROP FUNCTION kyc_decisions_reject_change()")
    op.drop_index(op.f('ix_kyc_decisions_reviewer_id'), table_name='kyc_decisions')
    op.drop_index(op.f('ix_kyc_decisions_submission_id'), table_name='kyc_decisions')
    op.drop_table('kyc_decisions')
    op.drop_index(op.f('ix_kyc_documents_user_id'), table_name='kyc_documents')
    op.drop_index(op.f('ix_kyc_documents_submission_id'), table_name='kyc_documents')
    op.drop_table('kyc_documents')
    op.drop_index('uq_kyc_submissions_one_open_per_user', table_name='kyc_submissions')
    op.drop_index(op.f('ix_kyc_submissions_status'), table_name='kyc_submissions')
    op.drop_index(op.f('ix_kyc_submissions_user_id'), table_name='kyc_submissions')
    op.drop_table('kyc_submissions')

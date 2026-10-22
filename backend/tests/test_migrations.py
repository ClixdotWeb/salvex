"""
The database layout must match the models, and the migration chain must be a single line.
(Upgrade/downgrade round trips change the schema of the shared test database, so they are run
by hand rather than in this suite; see docs/AUTHENTICATION.md.)
"""
from pathlib import Path

from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect

import app.models  # noqa: F401  (registers every model)
from app.core.config import settings
from app.db.base import Base

BACKEND = Path(__file__).resolve().parent.parent


def script() -> ScriptDirectory:
    return ScriptDirectory.from_config(Config(str(BACKEND / "alembic.ini")))


def test_migration_history_is_a_single_line_ending_at_the_session_migration():
    heads = script().get_heads()
    assert heads == ["7b2f4a9c1d3e"]
    revisions = [r.revision for r in script().walk_revisions()]
    assert revisions == ["7b2f4a9c1d3e", "c96cd80717e8", "493b43fb6f05"]


def test_the_test_database_is_at_the_latest_revision_and_matches_the_models():
    engine = create_engine(settings.sync_database_url)           # the isolated test database
    try:
        with engine.connect() as conn:
            context = MigrationContext.configure(conn)
            assert context.get_current_revision() == "7b2f4a9c1d3e"
            assert compare_metadata(context, Base.metadata) == []   # no drift between models and migrations
    finally:
        engine.dispose()


def test_auth_sessions_table_has_the_expected_shape():
    engine = create_engine(settings.sync_database_url)
    try:
        inspector = inspect(engine)
        columns = {c["name"]: c for c in inspector.get_columns("auth_sessions")}
        assert set(columns) == {"id", "user_id", "created_at", "last_seen_at", "expires_at", "revoked_at", "revoke_reason", "user_agent"}
        assert not columns["user_id"]["nullable"] and not columns["expires_at"]["nullable"]
        assert columns["revoked_at"]["nullable"]
        indexed = {tuple(i["column_names"]) for i in inspector.get_indexes("auth_sessions")}
        assert ("user_id",) in indexed and ("expires_at",) in indexed
        fk = inspector.get_foreign_keys("auth_sessions")[0]
        assert fk["referred_table"] == "users" and fk["options"].get("ondelete") == "CASCADE"
    finally:
        engine.dispose()

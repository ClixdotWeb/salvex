"""
Read-only SQL for the real-backend browser tests (tests/real). Prints rows as JSON.
Refuses any database that is not on this computer, and anything that is not a SELECT.
Usage (from backend/):  python ../tests/real/dbq.py "SELECT ..."
"""
import json
import sys
from urllib.parse import urlsplit

sys.path.insert(0, ".")
from app.core.config import settings  # noqa: E402
import psycopg2  # noqa: E402

url = settings.sync_database_url
if urlsplit(url).hostname not in ("127.0.0.1", "localhost"):
    sys.exit("refusing: DATABASE_URL is not a local database")
sql = sys.argv[1]
if not sql.lstrip().lower().startswith(("select", "with")):
    sys.exit("refusing: read-only queries only")
conn = psycopg2.connect(url)
conn.set_session(readonly=True)
cur = conn.cursor()
cur.execute(sql, sys.argv[2:] or None)
cols = [c[0] for c in cur.description]
print(json.dumps([dict(zip(cols, row)) for row in cur.fetchall()], default=str))

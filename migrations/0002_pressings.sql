CREATE TABLE IF NOT EXISTS pressings (
  id         TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  species    TEXT NOT NULL,
  chains     INTEGER NOT NULL,
  points     INTEGER NOT NULL,
  data       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pressings_created_at ON pressings (created_at DESC);

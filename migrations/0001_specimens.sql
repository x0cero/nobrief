CREATE TABLE IF NOT EXISTS specimens (
  id         TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  points     INTEGER NOT NULL,
  path       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS specimens_created_at ON specimens (created_at DESC);

CREATE TABLE IF NOT EXISTS saves (
  who TEXT NOT NULL,
  ts  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS saves_who_ts ON saves (who, ts);

CREATE TABLE IF NOT EXISTS agents (
  id          TEXT PRIMARY KEY,
  project     TEXT NOT NULL,
  agent_type  TEXT,
  avatar_seed TEXT NOT NULL,
  first_seen  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id    TEXT NOT NULL REFERENCES agents(id),
  mood        TEXT,
  text        TEXT,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id    TEXT NOT NULL REFERENCES agents(id),
  text        TEXT NOT NULL,
  mood        TEXT,
  code_block  TEXT,
  screenshot  TEXT,
  tags        TEXT,
  created_at  INTEGER NOT NULL,
  likes       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS replies (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id     INTEGER NOT NULL REFERENCES posts(id),
  agent_id    TEXT NOT NULL REFERENCES agents(id),
  text        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id     INTEGER NOT NULL REFERENCES posts(id),
  agent_id    TEXT NOT NULL REFERENCES agents(id),
  emoji       TEXT NOT NULL DEFAULT '♥',
  created_at  INTEGER NOT NULL,
  UNIQUE(post_id, agent_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_stories_expires ON stories(expires_at);
CREATE INDEX IF NOT EXISTS idx_stories_agent ON stories(agent_id);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_agent ON posts(agent_id);
CREATE INDEX IF NOT EXISTS idx_replies_post ON replies(post_id);
CREATE INDEX IF NOT EXISTS idx_reactions_post ON reactions(post_id);

-- Full-text search on posts
CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
  text,
  tags,
  content=posts,
  content_rowid=id
);

-- Keep FTS in sync on INSERT
CREATE TRIGGER IF NOT EXISTS posts_fts_insert AFTER INSERT ON posts BEGIN
  INSERT INTO posts_fts(rowid, text, tags) VALUES (new.id, new.text, new.tags);
END;

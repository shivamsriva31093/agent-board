-- === Agents (modified: added status fields) ===

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  agent_type TEXT,
  avatar_seed TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  status TEXT DEFAULT NULL,
  current_task TEXT DEFAULT NULL,
  status_updated_at INTEGER DEFAULT NULL
);

-- === Entries (replaces posts) ===

CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  text TEXT NOT NULL,
  summary TEXT,
  entry_type TEXT,
  scope TEXT,
  mood TEXT,
  code_block TEXT,
  screenshot TEXT,
  tags TEXT,
  created_at INTEGER NOT NULL,
  likes INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_entries_created ON entries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_agent ON entries(agent_id);
CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(entry_type);

-- FTS5 for text search
CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(text, tags, content=entries, content_rowid=id);

CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entries_fts(rowid, text, tags) VALUES (new.id, new.text, new.tags);
END;

-- === Stories (unchanged) ===

CREATE TABLE IF NOT EXISTS stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  mood TEXT,
  text TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stories_expires ON stories(expires_at);
CREATE INDEX IF NOT EXISTS idx_stories_agent ON stories(agent_id);

-- === Replies (post_id references entries.id -- kept as post_id for backward compat) ===

CREATE TABLE IF NOT EXISTS replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES entries(id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_replies_post ON replies(post_id);

-- === Reactions (post_id references entries.id) ===

CREATE TABLE IF NOT EXISTS reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES entries(id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  emoji TEXT NOT NULL DEFAULT '♥',
  created_at INTEGER NOT NULL,
  UNIQUE(post_id, agent_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_reactions_post ON reactions(post_id);

-- === Claims (NEW) ===

CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  scope TEXT NOT NULL,
  scope_type TEXT NOT NULL DEFAULT 'area',
  claimed_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE INDEX IF NOT EXISTS idx_claims_agent ON claims(agent_id);
CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status, expires_at);

-- === Digests (NEW) ===

CREATE TABLE IF NOT EXISTS digests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  scope_type TEXT NOT NULL DEFAULT 'project',
  summary TEXT NOT NULL,
  entry_count INTEGER NOT NULL DEFAULT 0,
  last_entry_id INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  UNIQUE(scope, scope_type)
);

-- === Syntheses (topic summaries + decision logs) ===

CREATE TABLE IF NOT EXISTS syntheses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL,
  topic TEXT NOT NULL,
  synthesis_type TEXT NOT NULL DEFAULT 'topic',
  summary TEXT NOT NULL,
  entry_ids TEXT NOT NULL DEFAULT '[]',
  entry_count INTEGER NOT NULL DEFAULT 0,
  last_entry_id INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(project, topic, synthesis_type)
);

CREATE INDEX IF NOT EXISTS idx_syntheses_project ON syntheses(project);

-- === Agent Memory (per-agent knowledge brief + expertise) ===

CREATE TABLE IF NOT EXISTS agent_memory (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id),
  knowledge_brief TEXT,
  expertise TEXT DEFAULT '{}',
  top_scopes TEXT DEFAULT '[]',
  entry_count INTEGER NOT NULL DEFAULT 0,
  last_entry_id INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- === Nudges (engagement tracking) ===

CREATE TABLE IF NOT EXISTS nudges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  engaged_at INTEGER DEFAULT NULL,
  UNIQUE(agent_id, entry_id)
);

CREATE INDEX IF NOT EXISTS idx_nudges_agent ON nudges(agent_id);

-- === Project Registry (cross-project discovery) ===

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT,
  aliases TEXT NOT NULL DEFAULT '[]',
  repo_paths TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Junction table: which entries mention which projects
CREATE TABLE IF NOT EXISTS entry_mentions (
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_entry_mentions_project ON entry_mentions(project_id);

-- === Search Synthesis Cache (for smart search question answering) ===

CREATE TABLE IF NOT EXISTS search_synthesis_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_hash TEXT NOT NULL,
  entry_ids_hash TEXT NOT NULL,
  query_text TEXT NOT NULL,
  synthesis TEXT NOT NULL,
  model TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(query_hash, entry_ids_hash)
);

CREATE INDEX IF NOT EXISTS idx_search_synthesis_cache_created ON search_synthesis_cache(created_at);

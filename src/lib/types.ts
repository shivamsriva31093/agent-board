// === Agent (modified: added status fields) ===

export interface Agent {
  id: string;              // "openrajya-os/opus-4a2e78"
  project: string;
  agent_type: string | null;
  avatar_seed: string;
  first_seen: number;      // Unix seconds
  last_seen: number;
  status: string | null;          // "active" | "idle" | "done"
  current_task: string | null;    // What the agent is doing
  status_updated_at: number | null;
}

// === Entry (replaces Post) ===

export interface Entry {
  id: number;
  agent_id: string;
  text: string;
  summary: string | null;
  entry_type: string | null;
  scope: string | null;           // JSON: ["src/db/", "auth"]
  mood: string | null;
  code_block: string | null;      // JSON: {lang, content, filename?}
  screenshot: string | null;
  tags: string | null;            // JSON array
  created_at: number;
  likes: number;
}

export interface EntryWithDetails extends Entry {
  agent: Agent;
  replies: (Reply & { agent: Agent })[];
  reactions: Reaction[];
  parsed_tags: string[];
  parsed_code_block: CodeBlock | null;
  parsed_scope: string[];
}

// === EntrySummary (compact form for search/feed results) ===

export interface EntrySummary {
  id: number;
  agent_id: string;
  project: string;
  summary: string | null;
  entry_type: string | null;
  mood: string | null;
  tags: string[];
  likes: number;
  reply_count: number;
  created_at: number;
  similarity?: number;
}

// === Story (unchanged) ===

export interface Story {
  id: number;
  agent_id: string;
  mood: string | null;
  text: string | null;
  created_at: number;
  expires_at: number;
}

export interface StoryWithAgent extends Story {
  agent: Agent;
}

// === Reply (unchanged) ===

export interface Reply {
  id: number;
  post_id: number;
  agent_id: string;
  text: string;
  created_at: number;
}

// === Reaction (unchanged) ===

export interface Reaction {
  id: number;
  post_id: number;
  agent_id: string;
  emoji: string;
  created_at: number;
}

// === CodeBlock (unchanged) ===

export interface CodeBlock {
  lang: string;
  content: string;
  filename?: string;
}

// === Claim (NEW) ===

export interface Claim {
  id: number;
  agent_id: string;
  scope: string;
  scope_type: string;    // "file" | "module" | "area"
  claimed_at: number;
  expires_at: number;
  status: string;        // "active" | "released"
}

export interface ClaimWithAgent extends Claim {
  agent: Agent;
}

// === Digest (NEW) ===

export interface Digest {
  id: number;
  scope: string;
  scope_type: string;    // "project" | "tag" | "global"
  summary: string;
  entry_count: number;
  last_entry_id: number;
  updated_at: number;
}

// === Brief (NEW — response shape for brief_me tool) ===

export interface BriefResponse {
  stats: { project: string; total: number; today: number }[];
  active_agents: { id: string; current_task: string | null }[];
  active_claims: { agent_id: string; scope: string; expires_in_minutes: number }[];
  in_your_projects: { id: number; agent_id: string; summary: string; project: string; created_at: number; entry_type: string | null }[];
  relevant_to_you: { id: number; agent_id: string; summary: string; project: string; created_at: number; entry_type: string | null; similarity: number }[];
}

// === AutoEngagement (response from auto-engage after posting) ===

export interface AutoEngagement {
  reactions: { entry_id: number; agent_id: string; emoji: string }[];
  replies: { entry_id: number; agent_id: string; text: string }[];
}

// === Synthesis (topic summary or decision log) ===

export interface Synthesis {
  id: number;
  project: string;
  topic: string;
  synthesis_type: string;   // "topic" | "decision"
  summary: string;
  entry_ids: number[];      // parsed from JSON
  entry_count: number;
  last_entry_id: number;
  created_at: number;
  updated_at: number;
}

// === AgentMemory (per-agent knowledge brief + expertise) ===

export interface AgentMemory {
  agent_id: string;
  knowledge_brief: string | null;
  expertise: Record<string, number>;   // parsed from JSON
  top_scopes: string[];                // parsed from JSON
  entry_count: number;
  last_entry_id: number;
  updated_at: number;
}

// === Nudge (engagement tracking) ===

export interface Nudge {
  entry_id: number;
  agent_id: string;     // author of the nudged entry
  summary: string;
  entry_type: string;
  reason: string;
  suggested_emoji: string;
  similarity: number;
}

// === Legacy aliases for backward compat during migration ===

/** @deprecated Use Entry */
export type Post = Entry;
/** @deprecated Use EntryWithDetails */
export type PostWithDetails = EntryWithDetails;

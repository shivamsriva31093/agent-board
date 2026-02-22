export interface Agent {
  id: string; // "openrajya-os/opus-4a2e78"
  project: string; // "openrajya-os"
  agent_type: string | null;
  avatar_seed: string;
  first_seen: number;
  last_seen: number;
}

export interface Story {
  id: number;
  agent_id: string;
  mood: string | null;
  text: string | null;
  created_at: number;
  expires_at: number;
}

export interface Post {
  id: number;
  agent_id: string;
  text: string;
  mood: string | null;
  code_block: string | null; // JSON: {lang, content, filename?}
  screenshot: string | null;
  tags: string | null; // JSON array
  created_at: number;
  likes: number;
}

export interface Reply {
  id: number;
  post_id: number;
  agent_id: string;
  text: string;
  created_at: number;
}

export interface Reaction {
  id: number;
  post_id: number;
  agent_id: string;
  emoji: string;
  created_at: number;
}

export interface CodeBlock {
  lang: string;
  content: string;
  filename?: string;
}

export interface PostWithDetails extends Post {
  agent: Agent;
  replies: (Reply & { agent: Agent })[];
  reactions: Reaction[];
  parsed_tags: string[];
  parsed_code_block: CodeBlock | null;
}

export interface StoryWithAgent extends Story {
  agent: Agent;
}

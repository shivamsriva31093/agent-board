/**
 * Text rendering for MCP tool output. Pure functions with no imports, so
 * the board's tests can measure exactly what agents receive.
 * Input types are structural copies of the board API's JSON responses.
 */
export interface BriefData {
    stats: {
        project: string;
        total: number;
        today: number;
    }[];
    active_agents: {
        id: string;
        current_task: string | null;
    }[];
    active_claims: {
        agent_id: string;
        scope: string;
        expires_in_minutes: number;
    }[];
    in_your_projects: {
        id: number;
        agent_id: string;
        summary: string;
        project: string;
        created_at: number;
    }[];
    mentions?: {
        id: number;
        summary: string;
        project: string;
        created_at: number;
        entry_type: string | null;
    }[];
    relevant_to_you: {
        id: number;
        agent_id: string;
        summary: string;
        project: string;
        created_at: number;
    }[];
}
export interface SearchResult {
    id: number;
    agent_id: string;
    summary: string | null;
    entry_type: string | null;
    tags: string[];
    likes: number;
    created_at: number;
    similarity?: number;
}
export interface ContextResponse {
    entries: {
        id: number;
        summary: string | null;
        entry_type: string | null;
        created_at: number;
        score: number;
        stale?: boolean;
        superseded_by?: number;
    }[];
    claims: {
        agent_id: string;
        scope: string;
        scope_type: string;
        expires_at: number;
    }[];
    conflicts: {
        scope: string;
        entries: {
            id: number;
            summary: string | null;
            entry_type: string | null;
            created_at: number;
        }[];
    }[];
    syntheses?: {
        topic: string;
        synthesis_type: string;
        summary: string;
        entry_count: number;
        entry_ids: number[];
    }[];
    truncated: boolean;
}
export declare function timeAgo(unixSeconds: number): string;
/**
 * The service returns every project, agent and claim (the web UI counts
 * them); the brief an agent reads is capped here to fit `maxTokens`.
 */
export declare function renderBrief(brief: BriefData, opts?: {
    project?: string;
    maxTokens?: number;
}): string;
export declare function renderSearch(query: string, results: SearchResult[]): string;
export declare function renderContext(data: ContextResponse): string;

"use client";

import { useState } from "react";
import AgentAvatar from "@/components/AgentAvatar";
import StoryViewer from "@/components/StoryViewer";

export interface StoryGroup {
  agent_id: string;
  project: string;
  avatar_seed: string;
  stories: {
    id: number;
    mood: string | null;
    text: string | null;
    created_at: number;
  }[];
}

interface StoryBarProps {
  groups: StoryGroup[];
}

export default function StoryBar({ groups }: StoryBarProps) {
  const [activeGroup, setActiveGroup] = useState<StoryGroup | null>(null);

  if (!groups.length) return null;

  return (
    <>
      <div className="flex gap-4 overflow-x-auto py-4 px-2 scrollbar-none">
        {groups.map((group) => {
          const shortName = group.agent_id.split("/").pop();
          return (
            <button
              key={group.agent_id}
              className="flex flex-col items-center gap-1 shrink-0 bg-transparent border-none cursor-pointer"
              onClick={() => setActiveGroup(group)}
            >
              <AgentAvatar
                seed={group.avatar_seed}
                size={56}
                ring
                ringColor="var(--color-accent)"
              />
              <span className="text-[10px] font-mono text-text-dim truncate max-w-[64px]">
                {shortName}
              </span>
            </button>
          );
        })}
      </div>

      {activeGroup && (
        <StoryViewer
          group={activeGroup}
          onClose={() => setActiveGroup(null)}
        />
      )}
    </>
  );
}

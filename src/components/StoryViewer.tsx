"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import AgentAvatar from "@/components/AgentAvatar";
import MoodBadge from "@/components/MoodBadge";
import { formatTimeAgo } from "@/lib/time";
import type { StoryGroup } from "@/components/StoryBar";

const STORY_DURATION = 5000; // 5 seconds per story

interface StoryViewerProps {
  group: StoryGroup;
  onClose: () => void;
}

export default function StoryViewer({ group, onClose }: StoryViewerProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [progressKey, setProgressKey] = useState(0);

  const story = group.stories[currentIndex];
  const total = group.stories.length;

  const goNext = useCallback(() => {
    if (currentIndex < total - 1) {
      setCurrentIndex((i) => i + 1);
      setProgressKey((k) => k + 1);
    } else {
      onClose();
    }
  }, [currentIndex, total, onClose]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((i) => i - 1);
      setProgressKey((k) => k + 1);
    }
  }, [currentIndex]);

  // Auto-advance timer
  useEffect(() => {
    const timer = setTimeout(goNext, STORY_DURATION);
    return () => clearTimeout(timer);
  }, [currentIndex, progressKey, goNext]);

  // Close on Escape key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handleTap = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < rect.width / 2) {
      goPrev();
    } else {
      goNext();
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 bg-black/95 flex flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      {/* Progress bars */}
      <div className="absolute top-4 left-4 right-4 flex gap-1 z-10">
        {group.stories.map((s, i) => (
          <div
            key={s.id}
            className="flex-1 h-0.5 rounded bg-white/20 overflow-hidden"
          >
            {i < currentIndex ? (
              /* Completed bar */
              <div className="h-full w-full rounded bg-white" />
            ) : i === currentIndex ? (
              /* Active bar with animation */
              <motion.div
                key={progressKey}
                className="h-full rounded bg-white"
                initial={{ width: "0%" }}
                animate={{ width: "100%" }}
                transition={{
                  duration: STORY_DURATION / 1000,
                  ease: "linear",
                }}
              />
            ) : null}
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="absolute top-8 left-4 right-4 flex items-center gap-3 z-10">
        <AgentAvatar seed={group.avatar_seed} size={32} />
        <span className="font-mono text-sm text-white">
          {group.agent_id}
        </span>
        <span className="text-xs text-white/50">
          {formatTimeAgo(story.created_at)}
        </span>
        <button
          className="ml-auto text-white/70 hover:text-white text-2xl leading-none bg-transparent border-none cursor-pointer"
          onClick={onClose}
          aria-label="Close stories"
        >
          &times;
        </button>
      </div>

      {/* Story content - tap zones */}
      <div
        className="flex-1 flex items-center justify-center cursor-pointer"
        onClick={handleTap}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={story.id}
            className="flex flex-col items-center gap-6 px-8 max-w-lg text-center"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <MoodBadge mood={story.mood} />
            {story.text && (
              <p className="text-2xl font-light text-white leading-relaxed">
                {story.text}
              </p>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

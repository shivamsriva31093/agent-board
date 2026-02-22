const moodColors: Record<string, string> = {
  vibing: "var(--color-mood-vibing)", // #00ff41
  struggling: "var(--color-mood-struggling)", // #ff4141
  focused: "var(--color-mood-focused)", // #00d4ff
  triumphant: "var(--color-mood-triumphant)", // #ffd700
  confused: "#ff8c00",
  eureka: "#ffd700",
  grinding: "#888",
};

interface MoodBadgeProps {
  mood: string | null;
}

export default function MoodBadge({ mood }: MoodBadgeProps) {
  if (!mood) return null;

  const color = moodColors[mood] ?? "#888";

  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded-full"
      style={{
        background: `${color}20`,
        color,
      }}
    >
      <span
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{ background: color }}
      />
      {mood}
    </span>
  );
}

const TYPE_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  bugfix:    { icon: "\u{1F527}", color: "text-red-400",     label: "bugfix" },
  discovery: { icon: "\u{1F50D}", color: "text-cyan-400",    label: "discovery" },
  decision:  { icon: "\u2696\uFE0F",  color: "text-yellow-400",  label: "decision" },
  pattern:   { icon: "\u{1F4D0}", color: "text-green-400",   label: "pattern" },
  warning:   { icon: "\u26A0\uFE0F",  color: "text-orange-400",  label: "warning" },
  question:  { icon: "\u2753", color: "text-purple-400",  label: "question" },
  shipped:   { icon: "\u{1F680}", color: "text-emerald-400", label: "shipped" },
  struggle:  { icon: "\u{1F624}", color: "text-red-300",     label: "struggle" },
};

export default function EntryTypeBadge({ type }: { type: string | null }) {
  if (!type) return null;
  const config = TYPE_CONFIG[type] ?? { icon: "\u{1F4DD}", color: "text-gray-400", label: type };
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${config.color} opacity-80`}>
      <span>{config.icon}</span>
      <span>{config.label}</span>
    </span>
  );
}

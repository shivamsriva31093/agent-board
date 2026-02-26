/**
 * Formats a Unix timestamp (seconds) as a relative time string.
 * e.g. "3s ago", "12m ago", "5h ago", "2d ago", "1mo ago"
 */
export function formatTimeAgo(unixSeconds: number): string {
  const diffMs = Date.now() - unixSeconds * 1000;
  const seconds = Math.floor(diffMs / 1000);

  if (seconds < 60) return `${Math.max(0, seconds)}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

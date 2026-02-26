const STORAGE_KEY = "agent-board-bookmarks";

export function getBookmarks(): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as number[]) : [];
  } catch {
    return [];
  }
}

export function isBookmarked(id: number): boolean {
  return getBookmarks().includes(id);
}

export function toggleBookmark(id: number): boolean {
  const bookmarks = getBookmarks();
  const index = bookmarks.indexOf(id);
  if (index >= 0) {
    bookmarks.splice(index, 1);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
    return false; // removed
  } else {
    bookmarks.unshift(id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
    return true; // added
  }
}

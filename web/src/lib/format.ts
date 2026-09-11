export function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 90) return 'a minute ago';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;

  return new Date(iso).toLocaleDateString();
}

export function hostnameOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export const formatChars = (count: number): string =>
  count >= 1000 ? `${(count / 1000).toFixed(1)}k chars` : `${count} chars`;

/** Relevance scores are cosine similarities in [0, 1]; show them as percentages. */
export const formatScore = (score: number): string => `${Math.round(score * 100)}%`;

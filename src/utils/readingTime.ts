export function getReadingTime(text: string): number {
  return Math.max(1, Math.ceil(text.trim().split(/\s+/).length / 200));
}

export function formatReadingTime(text: string): string {
  return `${getReadingTime(text)} min read`;
}

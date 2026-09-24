export type TranscriptScrollGeometry = {
  viewportTop: number;
  viewportBottom: number;
  itemTop: number;
  itemBottom: number;
  currentScrollTop: number;
  padding?: number;
};

export function transcriptScrollTarget({
  viewportTop,
  viewportBottom,
  itemTop,
  itemBottom,
  currentScrollTop,
  padding = 40,
}: TranscriptScrollGeometry) {
  const visibleTop = viewportTop + padding;
  const visibleBottom = viewportBottom - padding;

  if (itemTop >= visibleTop && itemBottom <= visibleBottom) return null;

  const viewportCenter = (viewportTop + viewportBottom) / 2;
  const itemCenter = (itemTop + itemBottom) / 2;
  return Math.max(0, Math.round(currentScrollTop + itemCenter - viewportCenter));
}

// Offset endpoints provide no total. Fall back once when an empty page follows a full one.
export async function readPage(load, items, page, advancing, isCurrent) {
  const result = await load(page);
  if (!result || !isCurrent()) return null;
  if (!advancing || page <= 1 || items(result).length > 0) return { result, end: false };
  const previous = await load(page - 1);
  return previous && isCurrent() ? { result: previous, end: true } : null;
}

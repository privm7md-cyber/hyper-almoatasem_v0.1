// Shared canonical-slug comparison for /c, /p, /brand routes (FP-09 D01 canonical redirect).
// Next.js hands dynamic `slug` params through as the raw URL segment, so non-ASCII slugs
// arrive percent-encoded while catalog slugs are decoded text. Compare on the decoded form;
// comparing raw forms redirects to the identical URL and loops forever.

export function slugMatches(wireSlug: string, canonicalSlug: string): boolean {
  if (wireSlug === canonicalSlug) return true;
  let decodedWire = wireSlug;
  try {
    decodedWire = decodeURIComponent(wireSlug);
  } catch {
    return false;
  }
  return decodedWire === canonicalSlug;
}

export function wireSlugOf(canonicalSlug: string): string {
  return encodeURIComponent(canonicalSlug);
}

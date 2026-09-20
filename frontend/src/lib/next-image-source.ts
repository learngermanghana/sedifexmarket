export const NEXT_IMAGE_PLACEHOLDER = 'https://placehold.co/640x640/172033/ffffff?text=Sedifex+Market';

const OPTIMIZED_REMOTE_IMAGE_ORIGINS = new Set([
  'http://storage.googleapis.com',
  'https://storage.googleapis.com',
  'http://firebasestorage.googleapis.com',
  'https://firebasestorage.googleapis.com',
  'https://placehold.co',
]);

/**
 * Keep sources passed to next/image in sync with next.config.mjs. Merchant data
 * may contain any HTTP(S) URL, but the optimizer must only receive allowlisted
 * remote origins. Local paths remain valid Next.js image sources.
 */
export const getOptimizableImageSource = (
  value: string | null | undefined,
  fallback = NEXT_IMAGE_PLACEHOLDER,
): string => {
  const source = value?.trim();
  if (!source) return fallback;
  if (source.startsWith('/') && !source.startsWith('//')) return source;

  try {
    const parsed = new URL(source);
    return OPTIMIZED_REMOTE_IMAGE_ORIGINS.has(parsed.origin) ? source : fallback;
  } catch {
    return fallback;
  }
};

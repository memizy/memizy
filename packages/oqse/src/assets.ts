/**
 * Asset lookup (kept in its own module without validation dependencies,
 * so lightweight consumers such as the plugin SDK can use it).
 */

import type { MediaObject, OQSEAnyItem, OQSEMeta } from './oqse';

/**
 * Looks up a media object for `<asset:key />` or `targetAsset`: first in the
 * item's own `assets`, then in `meta.assets`. The key is case-insensitive.
 */
export function resolveAsset(
  key: string,
  item: Pick<OQSEAnyItem, 'assets'> | undefined,
  meta: Pick<OQSEMeta, 'assets'> | undefined,
): MediaObject | undefined {
  const k = key.toLowerCase();
  return item?.assets?.[k] ?? meta?.assets?.[k];
}

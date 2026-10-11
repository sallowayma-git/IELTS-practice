/**
 * Shape contract for `reading_list_assets`.
 *
 * Rust returns `CommandResponse<Vec<AssetIndexEntry>>`, so `data` is a bare
 * array of entries that each carry a string `id`. This is the single place that
 * turns the response into that array; callers never re-check the shape.
 *
 * - array                      -> the entries
 * - null / undefined           -> [] (an empty library is not an error)
 * - anything else              -> throws `reading.asset_list_invalid`
 *
 * Entries that are not objects with an id cannot be started or counted, so
 * they are dropped (and reported once on the console) instead of crashing the
 * page later.
 */

export const READING_ASSET_LIST_INVALID = 'reading.asset_list_invalid'

function describe(value) {
  if (Array.isArray(value)) return 'array'
  return value === null ? 'null' : typeof value
}

function isIndexEntry(entry) {
  return Boolean(entry)
    && typeof entry === 'object'
    && !Array.isArray(entry)
    && String(entry.id ?? '').trim() !== ''
}

export function normalizeReadingAssetList(value) {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) {
    const error = new Error(`reading_list_assets: unexpected response shape (${describe(value)})`)
    error.code = READING_ASSET_LIST_INVALID
    throw error
  }
  const entries = value.filter(isIndexEntry)
  if (entries.length !== value.length) {
    console.warn(`reading_list_assets: dropped ${value.length - entries.length} malformed entries`)
  }
  return entries
}

/** Read all bounded pages before publishing the list or starting a review queue. */
export async function loadVocabulary(fetchPage, pageSize = 500) {
  const items = new Map()
  for (let offset = 0; ; offset += pageSize) {
    const page = await fetchPage(pageSize, offset)
    if (!Array.isArray(page) || page.length > pageSize) throw new Error('Invalid vocabulary page')
    const before = items.size
    for (const item of page) items.set(item.id, item)
    if (page.length < pageSize) return [...items.values()]
    if (items.size === before) throw new Error('Vocabulary pagination did not advance')
  }
}

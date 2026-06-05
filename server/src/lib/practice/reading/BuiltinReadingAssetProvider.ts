import type {
  PracticeAsset,
  ReadingAssetProvider,
  ReadingLibraryStatus
} from '../contracts.js'
import { createHttpError } from '../../shared/http.js'
import {
  clearReadingAssetCaches,
  loadReadingManifest,
  loadReadingPracticePayload,
  type ReadingManifest
} from './reading-generated-loader.js'

type ManifestEntry = Record<string, unknown>

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readAssetId(id: string, entry: ManifestEntry): string {
  return String(entry.examId || id).trim()
}

function toReadingAsset(id: string, entry: ManifestEntry): PracticeAsset {
  const script = asTrimmedString(entry.script) || null
  const dataKey = asTrimmedString(entry.dataKey) || null
  const examId = readAssetId(id, entry)
  return {
    id: examId,
    activity: 'reading',
    title: String(entry.title || entry.examId || id),
    source: 'reading_exam',
    category: typeof entry.category === 'string' ? entry.category : null,
    payloadRef: script ? (dataKey || examId) : null,
    metadata: {
      dataKey: script ? (dataKey || examId) : null,
      script,
      frequency: entry.frequency || null,
      pdfFilename: entry.pdfFilename || null,
      legacyPath: entry.legacyPath || null,
      legacyFilename: entry.legacyFilename || null,
      shuiPdf: entry.shuiPdf || null
    }
  }
}

function matchesAssetId(manifestId: string, entry: ManifestEntry, assetId: string): boolean {
  return manifestId === assetId
    || String(entry.examId || '').trim() === assetId
    || String(entry.dataKey || '').trim() === assetId
    || String(entry.legacyFilename || '').trim() === assetId
}

export class BuiltinReadingAssetProvider implements ReadingAssetProvider {
  private lastLoadedAt: string | null = null

  listAssets(): PracticeAsset[] {
    const manifest = this.loadManifest()
    return Object.entries(manifest)
      .map(([id, entry]) => toReadingAsset(id, entry))
      .sort((left, right) => left.id.localeCompare(right.id, 'en'))
  }

  getAsset(assetId: string): PracticeAsset {
    const normalizedAssetId = String(assetId || '').trim()
    if (!normalizedAssetId) {
      throw createHttpError('invalid_asset_id', 'Missing practice asset id')
    }
    const resolved = this.resolveManifestEntry(normalizedAssetId)
    if (!resolved) {
      throw createHttpError('practice_asset_not_found', `Reading asset not found: ${normalizedAssetId}`, 404)
    }
    return {
      ...toReadingAsset(resolved.assetId, resolved.entry),
      payload: loadReadingPracticePayload(resolved.assetId, resolved.entry)
    }
  }

  getStatus(): ReadingLibraryStatus {
    try {
      const manifest = this.loadManifest()
      const entries = Object.values(manifest)
      return {
        source: 'builtin',
        ready: true,
        assetCount: entries.length,
        htmlCount: entries.filter((entry) => asTrimmedString(entry.script)).length,
        pdfCount: entries.filter((entry) => entry.pdfFilename || entry.shuiPdf).length,
        version: null,
        lastLoadedAt: this.lastLoadedAt,
        error: null
      }
    } catch (error) {
      return {
        source: 'builtin',
        ready: false,
        assetCount: 0,
        version: null,
        lastLoadedAt: this.lastLoadedAt,
        error: error instanceof Error ? error.message : 'reading_library_status_failed'
      }
    }
  }

  refresh(): ReadingLibraryStatus {
    clearReadingAssetCaches()
    this.lastLoadedAt = null
    return this.getStatus()
  }

  private loadManifest(): ReadingManifest {
    const manifest = loadReadingManifest()
    if (!this.lastLoadedAt) {
      this.lastLoadedAt = new Date().toISOString()
    }
    return manifest
  }

  private resolveManifestEntry(assetId: string): { assetId: string; entry: ManifestEntry } | null {
    const manifest = this.loadManifest()
    const direct = manifest[assetId]
    if (direct) {
      return { assetId, entry: direct }
    }
    const match = Object.entries(manifest).find(([manifestId, entry]) => matchesAssetId(manifestId, entry, assetId))
    return match ? { assetId: match[0], entry: match[1] } : null
  }
}

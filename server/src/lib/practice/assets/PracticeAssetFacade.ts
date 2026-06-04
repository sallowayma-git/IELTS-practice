import type { ServiceBundle } from '../../../types/api.js'
import { createHttpError, normalizePagination, paginate } from '../../shared/http.js'
import {
  assertPracticeActivity,
  type PracticeAsset,
  type ReadingAssetProvider,
  type ReadingLibraryStatus,
  type ReadingPracticePayload
} from '../contracts.js'
import { BuiltinReadingAssetProvider } from '../reading/BuiltinReadingAssetProvider.js'

export interface ListAssetOptions {
  activity?: string | null
  page?: number
  limit?: number
  refresh?: boolean
}

function extractPlainText(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return ''
    try {
      return extractPlainText(JSON.parse(trimmed))
    } catch {
      return trimmed
    }
  }

  if (!value || typeof value !== 'object') {
    return ''
  }

  const node = value as Record<string, unknown>
  if (node.type === 'text') {
    return typeof node.text === 'string' ? node.text : ''
  }
  if (Array.isArray(node.content)) {
    return node.content.map((item) => extractPlainText(item)).join('')
  }
  return ''
}

export class PracticeAssetFacade {
  private readonly services: ServiceBundle
  private readonly readingAssetProvider: ReadingAssetProvider

  constructor(services: ServiceBundle, readingAssetProvider: ReadingAssetProvider = new BuiltinReadingAssetProvider()) {
    this.services = services
    this.readingAssetProvider = readingAssetProvider
  }

  get provider(): ReadingAssetProvider {
    return this.readingAssetProvider
  }

  async listReadingAssets(): Promise<PracticeAsset[]> {
    return this.readingAssetProvider.listAssets()
  }

  async listAssets(options: ListAssetOptions = {}) {
    const activity = options.activity ? assertPracticeActivity(options.activity) : null
    const { page, limit } = normalizePagination(options.page, options.limit)
    if (options.refresh && (!activity || activity === 'reading')) {
      await this.refreshReadingAssets()
    }

    if (activity === 'reading') {
      return paginate(await this.readingAssetProvider.listAssets(), page, limit)
    }

    if (activity === 'writing') {
      return this.listWritingAssets(page, limit)
    }

    const readingAssets = await this.readingAssetProvider.listAssets()
    const writingAssets = await this.listWritingAssets(1, limit)
    return paginate([
      ...readingAssets,
      ...writingAssets.data
    ], page, limit)
  }

  async getAsset(activity: string, assetId: string, options: { refresh?: boolean } = {}) {
    const normalizedActivity = assertPracticeActivity(activity)
    const normalizedAssetId = String(assetId || '').trim()
    if (!normalizedAssetId) {
      throw createHttpError('invalid_asset_id', 'Missing practice asset id')
    }

    if (normalizedActivity === 'reading') {
      if (options.refresh) {
        await this.refreshReadingAssets()
      }
      return this.readingAssetProvider.getAsset(normalizedAssetId)
    }

    const topic = await this.services.topicService.getById(Number(normalizedAssetId))
    if (!topic) {
      throw createHttpError('practice_asset_not_found', `Writing asset not found: ${normalizedAssetId}`, 404)
    }
    return this.toWritingAsset(topic)
  }

  async getReadingLibraryStatus(): Promise<ReadingLibraryStatus> {
    return this.readingAssetProvider.getStatus()
  }

  async refreshReadingAssets(): Promise<ReadingLibraryStatus> {
    return this.readingAssetProvider.refresh
      ? this.readingAssetProvider.refresh()
      : this.readingAssetProvider.getStatus()
  }

  async getReadingPayload(assetId: string): Promise<ReadingPracticePayload> {
    const asset = await this.readingAssetProvider.getAsset(assetId)
    if (!asset.payload) {
      throw createHttpError('reading_asset_payload_missing', `Reading asset payload is missing: ${assetId}`, 404)
    }
    return asset.payload
  }

  private async listWritingAssets(page: number, limit: number) {
    const result = await this.services.topicService.list({}, { page, limit })
    const data = Array.isArray(result?.data)
      ? result.data.map((topic: Record<string, unknown>) => this.toWritingAsset(topic))
      : []
    return {
      data,
      total: Number(result?.total || data.length),
      page: Number(result?.page || page),
      limit: Number(result?.limit || limit)
    }
  }

  private toWritingAsset(topic: Record<string, unknown>): PracticeAsset {
    const id = String(topic.id || '')
    const title = extractPlainText(topic.title_json) || `Writing topic ${id}`
    return {
      id,
      activity: 'writing',
      title,
      source: 'writing_topic',
      category: typeof topic.category === 'string' ? topic.category : null,
      difficulty: topic.difficulty as number | string | null,
      payloadRef: id,
      metadata: {
        taskType: topic.type || null,
        imagePath: topic.image_path || null,
        isOfficial: Boolean(topic.is_official)
      }
    }
  }
}

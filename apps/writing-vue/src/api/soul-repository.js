import { invokeCommand, unwrapCommandResponse } from './tauri-bridge.js'

/**
 * Soul repository — the settings page reads and edits the audited `soul.%`
 * preferences through the Tauri command surface. Undo only applies to a
 * model-made revision the field still matches; the backend decides that.
 */

async function call(name, args = {}) {
  try {
    return unwrapCommandResponse(await invokeCommand(name, args), name)
  } catch (error) {
    // Keep the backend's explanation (e.g. undo refused because the field was
    // edited afterwards) instead of replacing it with a generic sentence.
    if (error instanceof Error && error.message) throw error
    throw new Error(
      name === 'soul_undo'
        ? '暂时无法撤销，内容可能已被再次修改。请刷新后查看。'
        : '个人情况暂时未能保存或读取，请稍后重试。'
    )
  }
}

export function tomorrowDate() {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export const getSoul = () => call('soul_get')

export const updateSoul = async (fields) => {
  const band = fields['soul.targetBand']
  const exam = fields['soul.examDate']
  if (band != null && (!Number.isFinite(band) || band < 4 || band > 9 || band * 2 !== Math.round(band * 2))) {
    throw new Error('目标分请填写 4.0 到 9.0 之间的半分档。')
  }
  if (exam && exam < tomorrowDate()) throw new Error('请选择将来的考试日期。')
  return call('soul_update', { fields })
}

export const undoSoulRevision = (revisionId) => call('soul_undo', { revisionId })

/**
 * Pointer/keyboard-neutral selection state for legacy reading drag/drop.
 * DOM adapters decide what is an option or target; this controller owns the
 * single selected option and guarantees every read-only mode stays inert.
 */
export function createDragSelectionController(options = {}) {
  let selected = null

  const status = (message) => {
    if (typeof options.onStatus === 'function') options.onStatus(message)
  }
  const changed = () => {
    if (typeof options.onChange === 'function') options.onChange(selected)
  }
  const isReadOnly = () => Boolean(options.isReadOnly?.() || options.isReview?.())
  const readOnlyMessage = () => options.readOnlyMessage
    || (options.isReview ? '回顾模式为只读，不能修改答案。' : '当前模式为只读，不能修改答案。')

  function getSelected() {
    return selected ? { ...selected } : null
  }

  function clear(message = '') {
    selected = null
    changed()
    if (message) status(message)
  }

  function select(payload) {
    if (isReadOnly()) {
      status(readOnlyMessage())
      return false
    }
    const value = String(payload?.value || '').trim()
    if (!value) return false
    if (selected?.value === value && selected?.sourceQuestionId === String(payload?.sourceQuestionId || '')) {
      clear('已取消选择。')
      return false
    }
    selected = {
      value,
      label: String(payload?.label || value).trim() || value,
      sourceQuestionId: String(payload?.sourceQuestionId || '').trim()
    }
    changed()
    status(`已选择 ${selected.label}，请选择目标位置。`)
    return true
  }

  function place(questionId, assign) {
    if (isReadOnly()) {
      status(readOnlyMessage())
      return false
    }
    if (!selected) {
      status('请先选择一个选项。')
      return false
    }
    const accepted = assign?.(String(questionId || '').trim(), getSelected())
    if (accepted === false) return false
    const label = selected.label
    clear(`已将 ${label} 放入目标位置。`)
    return true
  }

  function activateKey(key, activate) {
    if (isReadOnly()) return false
    if (key === 'Escape') {
      clear('已取消选择。')
      return true
    }
    if (key !== 'Enter' && key !== ' ' && key !== 'Spacebar') return false
    activate?.()
    return true
  }

  return { getSelected, clear, select, place, activateKey }
}

export default createDragSelectionController

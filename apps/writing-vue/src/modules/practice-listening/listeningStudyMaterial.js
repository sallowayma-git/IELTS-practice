function retainTranslations(part, previous) {
  const translated = new Map((previous?.paragraphs || []).flatMap(paragraph =>
    paragraph.sentences.filter(sentence => sentence.translation).map(sentence => [sentence.id, sentence])))
  if (!translated.size) return part
  const paragraphs = (part.paragraphs || []).map(paragraph => ({
    ...paragraph,
    sentences: paragraph.sentences.map(sentence => {
      const retained = translated.get(sentence.id)
      return !sentence.translation && retained && retained.text === sentence.text
        ? { ...sentence, translation: retained.translation, sourceTextHash: retained.sourceTextHash }
        : sentence
    })
  }))
  const complete = paragraphs.every(paragraph => paragraph.sentences.every(sentence => sentence.translation))
  return { ...part, paragraphs, translationStatus: complete ? 'ready' : part.translationStatus }
}

export function mergeListeningStudyMaterial(previous, incoming) {
  if (!incoming?.parts) return previous
  if (!previous?.parts) return incoming
  const previousParts = new Map(previous.parts.map(part => [part.id, part]))
  const parts = incoming.parts.map(part => retainTranslations(part, previousParts.get(part.id)))
  const questions = { ...previous.questions }
  for (const [id, question] of Object.entries(incoming.questions || {})) {
    const retained = questions[id]
    questions[id] = {
      ...question,
      analyses: question.analyses?.length ? question.analyses : retained?.analyses || [],
      sentenceIds: question.sentenceIds?.length ? question.sentenceIds : retained?.sentenceIds || []
    }
  }
  const missing = incoming.missing || previous.missing
  if (!missing) return { ...incoming, parts, questions }
  const translationParts = (missing.translationParts || []).filter(section =>
    parts.some(part => Number(part.section) === section && part.translationStatus !== 'ready'))
  const analysisQuestions = (missing.analysisQuestions || []).filter(id => !Object.hasOwn(questions, id))
  return {
    ...incoming, parts, questions, analysesComplete: analysisQuestions.length === 0,
    missing: { translationParts, analysisQuestions }
  }
}

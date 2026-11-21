// Runs only inside the separate, same-origin product window. No cookies,
// credentials, signing implementation or generic local IPC cross this boundary.
function startIdictationRead(slot, operation, input) {
  const origin = 'https://www.idictation.cn'
  const versions = {
    '/assets/index-119a4b05.js': { hash:'51d0c314236baeb59da92c76d2f551b92a7420d15894440e3a24e7d3992823eb', post:'c$' },
    '/assets/index-64364bef.js': { hash:'234e3d8511764006795aa50f2bc7dd712f940b40438030ebf2289f2a6b73425d', post:'d7' }
  }
  const allowed = {
    readingCatalog: '/api/study/zhenti/v1/combined/jianya/list',
    readingExam: null,
    readingSubmit: '/api/study/yuedu-zhenti/v1/submit',
    account: '/api/study/customer/v1/login/msg',
    books: '/api/study/lexicon/v1/group/list',
    chapters: '/api/study/lexicon/v2/chapter/list',
    words: '/api/study/lexicon/v1/list',
    readerCatalog: '/api/study/reader/v1/documents/list',
    readerDocument: '/api/study/reader/v1/documents/show',
    articleChapters: '/api/study/lexicon/v2/chapter/list',
    articleDocument: '/api/study/article/v1/list',
    articleAudio: null,
    trainingWords: '/api/study/lexicon/v1/list',
    trainingDictionary: '/api/notice/diy-string/2',
    trainingPreferences: '/api/study/customer/v1/login/msg',
    trainingAnswer: '/api/study/lexicon/v1/practice/result',
    trainingAudio: null,
    trainingFinish: '/api/study/lexicon/v1/chapter/list',
    trainingMastery: '/api/study/lexicon/v1/mastery/short-term/count'
  }
  if (window.top !== window || location.origin !== origin || !Object.hasOwn(allowed, operation)) return false
  const scripts = [...document.querySelectorAll('script[type="module"][src]')]
    .map(script => script.src).filter(src => src.startsWith(origin + '/assets/index-') && src.endsWith('.js'))
  if (!scripts.length) return 'loading'
  const entry = scripts.find(src => Object.hasOwn(versions, src.slice(origin.length)))
  if (!entry) return 'version'
  const version = versions[entry.slice(origin.length)]
  const pick = (row, fields) => Object.fromEntries(fields.filter(k => Object.hasOwn(row, k)).map(k => [k, row[k]]))
  const project = value => {
    if (operation === 'readingCatalog') return value.books.flatMap(book => book.children
      .filter(test => test.reading?.test_id)
      .map(test => ({ id:test.reading.test_id, title:[book.name,test.name].join(' ') })))
    if (operation === 'readingSubmit') return null
    if (operation === 'readingExam') {
      const result = row => row == null ? null : pick(row, [
        'id','user_id','jianya_test_id','jianya_part_id','jijing_test_id','jijing_part_id',
        'g_jianya_test_id','g_jianya_part_id','class_exam_id','action','key','answer','result_blanks',
        'duration','zhengquelv','zhengquegeshu','created_at','updated_at','highlights','notes'
      ])
      return { ...pick(value,['test_id','jianya_name','test_name']),
        practice_result:result(value.practice_result),
        practice_result_shoudong:result(value.practice_result_shoudong),
        parts:value.parts.map(part=>({
          ...pick(part,['paper_id','title','question_number','content','paragraph_img']),
          question:part.question.map(group=>({
            ...pick(group,['type','group_id','desc','title','question_title','collect','img_url']),
            collect_option:group.collect_option,
            list:group.list.map(item=>pick(item,['id','number','title','option','display_answer','img_url']))
          }))
        }))
      }
    }
    if (operation === 'trainingPreferences') return { id:value.id, config:pick(value.config,
      ['is_check_size','word_wrong_word_cycle','wrong_wrong_word_cycle','phonetic_type','play_speed']) }
    if (operation === 'trainingDictionary') return { string:value.string }
    if (operation === 'trainingFinish') {
      const chapter=value[0]
      if (!chapter || !Object.hasOwn(chapter,'accuracy')) throw {atlasCode:'request'}
      return pick(chapter,['accuracy','generate_stories_number'])
    }
    if (operation === 'trainingMastery') return pick(value,['short_term_count'])
    if (operation === 'trainingAnswer' || operation === 'trainingAudio' || operation === 'articleAudio') return value
    if (operation === 'articleChapters') return {chapters:value.chapters.map(group=>({title:group.title,list:group.list.map(row=>({
      ...pick(row,['id','g_id','name','article_duration','word_total']),short_chapter:row.short_chapter?pick(row.short_chapter,['id','g_id','word_total']):null
    }))}))}
    if (operation === 'articleDocument') return {...pick(value,['total','sentence_mode','canonical_g_id','canonical_c_id']),
      data:value.data.map(row=>pick(row,['id','g_id','c_id','ac_id','content','translate','grammar_analysis','start_time','end_time','end_time_new',
        'subtitle_alignment_details','long_article_id','short_article_ids','is_answer_sentence','cloze_details','split_audio_url_new','split_audio_url','phonetic']))}
    if (operation === 'account') return {
      id: value.id,
      memberStatus: value.member?.status || '',
      enterpriseAllowed: value.enterprise_pro?.can_use === true
    }
    if (operation === 'books') return value.map(row => pick(row,
      ['id', 'g_id', 'name', 'type', 'need_buy', 'already_buy', 'word_total', 'chapter_total']))
    if (operation === 'chapters') return { chapters: value.chapters.map(group => ({
      title: group.title,
      list: group.list.map(row => pick(row, ['id', 'g_id', 'name', 'word_total', 'lexicon_count']))
    })) }
    if (operation === 'readerCatalog') return {
      page: value.page, total: value.total, page_size: value.page_size,
      items: value.items.map(row => pick(row, ['id', 'subject', 'track', 'book_number',
        'test_number', 'part_number', 'title', 'word_count', 'version_id']))
    }
    if (operation === 'readerDocument') return {
      document: pick(value.document, ['id', 'provider', 'subject', 'source_type', 'source_id',
        'book_number', 'test_number', 'part_number', 'track']),
      version: pick(value.version, ['id', 'document_id', 'version_no', 'title', 'language',
        'word_count', 'reading_seconds', 'sentence_count', 'content_hash', 'formatter_version']),
      blocks: value.blocks.map(block => ({
        ...pick(block, ['id', 'document_version_id', 'block_key', 'type', 'sort', 'label', 'text']),
        sentences: block.sentences.map(row => pick(row, ['id', 'document_version_id', 'block_id',
          'sentence_key', 'sort', 'start_offset', 'end_offset', 'translation', 'grammar_analysis', 'cues']))
      })),
      media: value.media.map(row => pick(row, ['id', 'kind', 'url']))
    }
    if (operation === 'trainingWords') return { total:value.total, existing_id:value.existing_id,last_key:value.last_key,
      data:value.data.map(row=>pick(row,['id','g_id','c_id','word','translate','phonetic_transcription',
        'various_words','spelling_combinations','error_options','is_proficient','phonetic-m','phonetic-y',
        'word_audio_url','answer_sentence_audio_url'])) }
    return { total: value.total, data: value.data.map(row => pick(row,
      ['id', 'g_id', 'c_id', 'word', 'translate', 'phonetic_transcription', 'example'])) }
  }
  const controller = new AbortController()
  const state = { ready: false, cancel: () => controller.abort() }
  Object.defineProperty(window, slot, { value: state, configurable: true })
  if (operation === 'articleAudio') {
    window.__atlasArticleAudioRequest?.cancel()
    window.__atlasArticleAudioRequest={sessionId:input.sessionId,cancel:state.cancel}
    if(window.__atlasArticleStoppedSession===input.sessionId||window.__atlasArticlePausedSession===input.sessionId)controller.abort()
  }
  if (operation === 'trainingAudio') {
    window.__atlasVocabularyAudioRequest?.cancel()
    window.__atlasVocabularyAudioRequest = {sessionId:input.sessionId,cancel:state.cancel}
    if (window.__atlasVocabularyStoppedSession === input.sessionId) controller.abort()
  }
  const ensureActive = () => {
    if (controller.signal.aborted || window[slot] !== state || location.origin !== origin) throw { atlasCode: 'cancelled' }
  }
  // Reuses the exact entry already loaded by this page: importing another
  // version or importing on a blank page would mount the product a second time.
  // Pin both URL and content. A changed deployment fails closed instead of
  // interpreting the same minified export name as another operation.
  fetch(entry, { credentials: 'same-origin', cache: 'force-cache', signal: controller.signal }).then(async response => {
    ensureActive()
    if (!response.ok) throw { atlasCode: 'version' }
    const bytes = await response.arrayBuffer()
    ensureActive()
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map(byte => byte.toString(16).padStart(2, '0')).join('')
    ensureActive()
    if (hash !== version.hash) throw { atlasCode: 'version' }
    return import(entry)
  }).then(async module => {
    ensureActive()
    const post = module[version.post]
    if (typeof post !== 'function') throw { atlasCode: 'version' }
    if (operation === 'articleAudio') return startArticleAudio(input,controller.signal,state)
    if (operation === 'trainingAnswer' || operation === 'trainingFinish' || operation === 'readingSubmit') {
      const account = await post({url:allowed.account,data:{},signal:controller.signal})
      ensureActive()
      if (!input.expectedOwner || String(account.id)!==input.expectedOwner) throw {atlasCode:'account'}
    }
    if (operation === 'readingExam') {
      if (!/^[1-9]\d{0,14}$/.test(input.testId)) throw {atlasCode:'request'}
      return post({url:'/api/study/yuedu-zhenti/v1/jianya/test/show/'+input.testId,data:{},signal:controller.signal})
    }
    if (operation === 'readingSubmit') return post({url:allowed.readingSubmit,data:input.request,signal:controller.signal})
    if (operation === 'trainingFinish') return post({url:allowed.trainingFinish,data:input.request,signal:controller.signal})
    if (operation === 'trainingAudio') {
      window.__atlasVocabularyAudio?.pause()
      const audio = new Audio()
      window.__atlasVocabularyAudio = audio
      audio.atlasSessionId = input.sessionId
      controller.signal.addEventListener('abort',()=>{
        if (!state.keepAudio && window.__atlasVocabularyAudio===audio) {audio.pause();audio.src=''}
      },{once:true})
      audio.src = input.url
      audio.playbackRate = input.speed
      return new Promise((resolve,reject)=>{
        controller.signal.addEventListener('abort',()=>reject({atlasCode:'cancelled'}),{once:true})
        audio.play().then(()=>resolve({playing:true}),reject)
      })
    }
    if (operation === 'trainingAnswer') {
      if (typeof module.aP !== 'function' || typeof module.aQ !== 'function') throw {atlasCode:'version'}
      const list = value => {
        if (Array.isArray(value)) return value
        if (typeof value !== 'string' || !value.trim()) return []
        try { const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed:[] } catch { return [value] }
      }
      const reverse=Object.fromEntries(Object.entries(input.dictionary).map(([key,value])=>[value.toLowerCase(),key]))
      const normalize=value=>module.aP(module.aQ(String(value||'').replace(/,/g,''),input.dictionary,reverse),input.word.word.includes(' '))
      const spellings=list(input.word.spelling_combinations)
      const variants=list(spellings.length>1?spellings:input.word.various_words).filter(v=>v!=null&&v!=='')
      const fold=value=>input.ignoreCase?value.toLowerCase():value
      const typed=fold(normalize(input.typed)), expected=fold(normalize(input.word.word))
      const correct=input.choiceCorrect == null
        ? Boolean(typed===expected || typed && variants.map(v=>fold(normalize(v))).includes(typed))
        : input.choiceCorrect === true
      const body={...input.request,type:correct?'success':'fail'}
      if (!correct) body.error_word=input.choiceCorrect == null?input.typed:''
      if (input.cycle) body.if_learned=correct&&!input.hasFuture?1:0
      return post({url:allowed.trainingAnswer,data:body,signal:controller.signal}).then(()=>({correct}))
    }
    return post({ url: allowed[operation], data: input, signal: controller.signal })
  }).then(value => {
    ensureActive()
    state.result = { ok: true, value: project(value) }
  }).catch(error => {
    const status = Number(error?.status)
    state.result = { ok: false, error: status === 401 ? 'expired'
      : error?.atlasCode === 'version' ? 'version' : error?.atlasCode === 'account' ? 'account' : 'request' }
  }).finally(() => {
    state.ready = true
    if (window.__atlasVocabularyAudioRequest?.cancel===state.cancel) delete window.__atlasVocabularyAudioRequest
    if (window.__atlasArticleAudioRequest?.cancel===state.cancel) delete window.__atlasArticleAudioRequest
  })
  return true
}

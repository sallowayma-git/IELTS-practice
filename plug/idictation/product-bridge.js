// Runs only inside the separate, same-origin product window. No cookies,
// credentials, signing implementation or generic local IPC cross this boundary.
function startIdictationRead(slot, operation, input) {
  const origin = 'https://www.idictation.cn'
  const versions = {
    '/assets/index-119a4b05.js': { hash:'51d0c314236baeb59da92c76d2f551b92a7420d15894440e3a24e7d3992823eb', post:'c$', fold:'aP', numbers:'aQ', sentenceScore:'gF' },
    '/assets/index-64364bef.js': { hash:'234e3d8511764006795aa50f2bc7dd712f940b40438030ebf2289f2a6b73425d', post:'d7', fold:'aP', numbers:'aQ', sentenceScore:'gL' },
    '/assets/index-7417cec6.js': {
      hash:'54aadc6cf08821ef8c7f5b4f79db1c4bfd3a16af60a6753158a32f3db69ab46a', post:'d7', fold:'aO', numbers:'aP', sentenceScore:'gO',
      cloze:{path:'/assets/setting.vue_vue_type_script_setup_true_lang-91776fc4.js',hash:'87641346ce2adc310f652a4eec71af609072ae844bf34d16135925b3f6badc28'},
      synonym:{path:'/assets/index-76955eec.js',hash:'ebe693ad114d9dab8849f579997752eafcfd34ab5e1edae7e77f927bc92eab31'}
    },
    '/assets/index-dab1aca2.js': {
      hash:'7fb63b819e74ca9b6857cd7ba40a7f4eb442ff46fb64244309c9538869b2d8b6', post:'d7', fold:'aO', numbers:'aP', sentenceScore:'gO',
      cloze:{path:'/assets/setting.vue_vue_type_script_setup_true_lang-3d4d67c2.js',hash:'3014ffc74657bb97e578c42f681d269cc0015cd9f87358e30638f91c7c96c50f'},
      synonym:{path:'/assets/index-cdf3ce3c.js',hash:'c43458722a5f8ab46d9dd9f10526cb45fee075a2a7dcee87798c0d097bed946f'}
    }
  }
  const synonym = {
    synonymBooks: { exportName: 'l' },
    synonymChapters: { exportName: 'a', field: 'book_id' },
    synonymChapter: { exportName: 'g', field: 'chapter_id' }
  }
  const allowed = {
    readingCatalog: '/api/study/zhenti/v1/combined/jianya/list',
    listeningCatalog: '/api/study/zhenti/v1/combined/jianya/list',
    listeningJijingCatalog: '/api/study/zhenti/v1/combined/jijing/list',
    writingCatalog: '/api/study/zhenti/v1/combined/jianya/list',
    writingJijingTask1: '/api/study/xiezuo-jijing/v1/xiaozuowen/list',
    writingJijingTask2: '/api/study/xiezuo-jijing/v1/dazuowen/list',
    writingGeneralTask2: '/api/study/xiezuo-g-zhenti/v1/dazuowen/list',
    writingExtraPrompt: null,
    speakingPart1: '/api/study/kouyu-zhenti/v1/part1/list',
    speakingPart2: '/api/study/kouyu-zhenti/v1/part2/list',
    speakingTopic: null,
    readingExam: null,
    listeningExam: null,
    listeningJijingExam: null,
    listeningJijingPart: null,
    writingExam: null,
    readingSubmit: '/api/study/yuedu-zhenti/v1/submit',
    account: '/api/study/customer/v1/login/msg',
    books: '/api/study/lexicon/v1/group/list',
    chapters: '/api/study/lexicon/v2/chapter/list',
    words: '/api/study/lexicon/v1/list',
    mistakeWords: '/api/study/lexicon/v1/error/list',
    synonymBooks: null,
    synonymChapters: null,
    synonymChapter: null,
    readerCatalog: '/api/study/reader/v1/documents/list',
    readerDocument: '/api/study/reader/v1/documents/show',
    readerCollections: '/api/study/reader/v1/sentences/collections/list',
    readerBookmark: '/api/study/reader/v1/sentences/bookmarks/set',
    readerProgress: '/api/study/reader/v1/progress/save',
    readerCompletion: '/api/study/reader/v1/progress/completion/set',
    readerAnnotationSave: '/api/study/reader/v1/annotations/save',
    readerAnnotationDelete: '/api/study/reader/v1/annotations/delete',
    articleChapters: '/api/study/lexicon/v2/chapter/list',
    articleDocument: '/api/study/article/v1/list',
    articleCollections: '/api/study/article/v2/collect/list',
    articleMark: 'api/study/article/v1/practice/biaoji/result',
    articleCollect: null,
    articleAudio: null,
    articleCloze: null,
    articleSentenceScore: null,
    articleDictationSave: '/api/study/article/v1/practice/result',
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
  const expandPrompt = html => {
    if (typeof html !== 'string' || !html.trim() || html.length > 24000) throw {atlasCode:'request'}
    const template = document.createElement('template')
    template.innerHTML = html
    const fragment = template.content
    fragment.querySelectorAll('script,style,template,iframe,object,embed').forEach(node => node.remove())
    // Keep structural breaks but never send remote HTML to the Atlas editor.
    fragment.querySelectorAll('br').forEach(node => node.replaceWith('\n'))
    fragment.querySelectorAll('p,div,li,tr,blockquote,h1,h2,h3,h4,h5,h6').forEach(node => node.append('\n'))
    const images = [...fragment.querySelectorAll('img')].map(node => node.getAttribute('src'))
    return { text: fragment.textContent.replace(/[ \t\u00a0]+/g, ' ').trim(), images }
  }
  const loadChart = async raw => {
    const limit = 3 * 1024 * 1024
    const validTypes = ['image/png', 'image/jpeg', 'image/webp']
    const invalid = () => { throw {atlasCode:'writingImage'} }
    const asDataUrl = (type, bytes) => {
      const starts = pattern => bytes.length >= pattern.length && pattern.every((value, index) => bytes[index] === value)
      const isPng = starts([137,80,78,71,13,10,26,10])
      const isJpeg = starts([255,216,255])
      const isWebp = starts([82,73,70,70]) && [87,69,66,80].every((value,index)=>bytes[index+8]===value)
      if (!(type === 'image/png' && isPng || type === 'image/jpeg' && isJpeg || type === 'image/webp' && isWebp)) invalid()
      let binary = ''
      for (let i=0;i<bytes.length;i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192))
      return 'data:'+type+';base64,'+btoa(binary)
    }
    const direct = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(raw)
    if (direct) {
      if (direct[2].length > Math.ceil(limit / 3) * 4) invalid()
      return asDataUrl(direct[1], Uint8Array.from(atob(direct[2]), ch => ch.charCodeAt(0)))
    }
    if (!raw.startsWith('https://') && !(raw.startsWith('/') && !raw.startsWith('//'))) invalid()
    const target = new URL(raw, origin)
    const pathname = decodeURIComponent(target.pathname)
    // A media URL comes only from the official paper reply. Do not follow
    // redirects or interpret API paths and other hosts as chart locations.
    if (target.origin !== origin || target.username || target.password || target.hash ||
        /[\\%]/.test(pathname) || pathname.split('/').some(part => part === '..') ||
        /^\/api(?:\/|$)/i.test(pathname) || !/\.(?:png|jpe?g|webp)$/i.test(pathname)) invalid()
    const response = await fetch(target.href, { credentials:'same-origin', redirect:'error', signal:controller.signal })
    ensureActive()
    const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
    if (!response.ok || !validTypes.includes(type) || !response.body ||
        Number(response.headers.get('content-length')) > limit) invalid()
    const chunks = []
    const reader = response.body.getReader()
    let size = 0
    try {
      for (;;) {
        const {done,value} = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > limit) invalid()
        chunks.push(value)
      }
    } finally {
      if (size > limit) await reader.cancel().catch(()=>{})
      reader.releaseLock()
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return asDataUrl(type, bytes)
  }
  const object = value => {
    if (typeof value === 'string') {
      try { value = JSON.parse(value) } catch { return {} }
    }
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  }
  const text = value => typeof value === 'string' && value.trim()
    ? expandPrompt(value.replace(/\\r\\n?|\\n/g, '\n')).text
    : ''
  const speakingRows = (value, max = 500) => {
    if (!Array.isArray(value) || value.length > max) throw {atlasCode:'request'}
    return value
  }
  const topicQuestions = (value, part) => {
    const rows = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : []
    return speakingRows(rows, 100).map(row => {
      const ideas = object(row.answer_ideas)
      const bilingual = (en, zh) => ({en:text(en),zh:text(zh)})
      return {
        id:row.topic_issues_id ?? row.id, owner:row.oral_materials_id, part,
        title:text(row.mkt_topic_issues_title || row.question_title || row.topic_problem || ideas.question),
        audio:ideas.question_audio_url ?? null,
        cues:[row.problem_prompt,row.problem_guide,row.mkt_topic_issues_example1,row.mkt_topic_issues_example2].map(text).filter(Boolean),
        ideas:speakingRows(ideas.ideas ?? [], 12).map(idea => ({
          title:bilingual(idea.title_en || idea.en, idea.title_zh || idea.zh),
          points:speakingRows(idea.points ?? [], 24).map(point => bilingual(point.en || point.title_en, point.zh || point.title_zh)),
          samples:[idea.band_6_0,idea.band_7_0].map(sample => bilingual(sample?.en,sample?.zh))
        }))
      }
    })
  }
  const listeningPart = (part, jijing) => ({
    ...pick(part, ['paper_id', 'title', 'question_number', 'full_audio', 'paragraph_img']),
    ...(jijing ? {
      file_url:part.file_url,
      question_number:part.question.flatMap(group => group.list.map(item => item.number))
    } : {}),
    content: part.content.map(row => pick(row, ['en_text', 'cn_text', 'start_time', 'end_time'])),
    question: part.question.map(group => ({
      ...pick(group, ['type', 'group_id', 'desc', 'title', 'question_title', 'collect', 'img_url']),
      collect_option: group.collect_option,
      list: group.list.map(item => pick(item, ['id', 'number', 'title', 'option', 'display_answer', 'img_url']))
    }))
  })
  const writingContent = row => {
    const raw = object(row.detail_raw_payload || row.raw_payload)
    return {content:row.content || raw.content || '', image:row.img_url || raw.img_url || ''}
  }
  const writingRows = value => {
    if (Array.isArray(value.list)) return value.list
    if (!Array.isArray(value.books)) throw {atlasCode:'request'}
    return value.books.flatMap(book => (book.children || []).flatMap(test => (test.children || []).map(paper => ({
      ...paper,test_id:paper.test_id ?? test.test_id
    }))))
  }
  const writingId = value => {
    if (!/^[1-9]\d{0,14}$/.test(String(value))) return null
    return Number(value)
  }
  const project = value => {
    if (operation === 'readerAnnotationSave') return {
      ...pick(value,['id','client_key','kind','note','lock_version']),
      anchor_segments:Array.isArray(value.anchor_segments)
        ? value.anchor_segments.map(segment => pick(segment,['block_key','start','end','quote'])) : []
    }
    if (operation === 'readerAnnotationDelete') return true
    if (operation === 'readerProgress') return pick(value, ['lock_version'])
    if (operation === 'readerCompletion') return pick(value, ['document_id','completed','completed_at'])
    if (operation === 'readerBookmark') {
      if (value?.collected !== input.collected ||
          (value.collected && (!value.annotation?.id || value.annotation.kind !== 'bookmark'))) throw {atlasCode:'request'}
      return value.collected
    }
    if (operation === 'articleMark' || operation === 'articleCollect') return true
    if (operation === 'articleCloze' || operation === 'articleSentenceScore' || operation === 'articleDictationSave') return value
    if (operation === 'speakingPart1' || operation === 'speakingPart2') {
      return ['list','non_mainland_list','practiced_list'].map(key =>
        speakingRows(value[key] ?? []).map(row => ({
          id:row.oral_materials_id, title:text(row.mkt_oral_materials_title),
          part:row.part_type, locked:row.mkt_oral_materials_lock, offline:row.is_offline
        })))
    }
    if (operation === 'speakingTopic') {
      const topic = value.topic
      const part = Number(topic.part_type)
      const detail = object(topic.detail_text)
      const primary = part === 2 ? detail.tIssuesPart2 : detail.mktTopicIssuesList
      const questions = topicQuestions(primary, part)
      const result = {
        id:topic.oral_materials_id, part, locked:topic.mkt_oral_materials_lock, offline:topic.is_offline,
        title:text(topic.mkt_oral_materials_title),
        questions:[...(questions.length ? questions : topicQuestions(topic.topic_issues, part)),
          ...(part === 2 ? topicQuestions(detail.mktTopicIssuesList, 3) : [])]
      }
      if (JSON.stringify(result).length > 512_000) throw {atlasCode:'request'}
      return result
    }
    if (operation === 'writingExam' || operation === 'writingExtraPrompt') return value
    if (['writingJijingTask1','writingJijingTask2','writingGeneralTask2'].includes(operation)) {
      const rows = writingRows(value)
      if (rows.length > 2000) throw {atlasCode:'request'}
      return rows.map(row => ({
        paperId:writingId(row.paper_id || row.id), testId:writingId(row.test_id),
        title:text(row.name || row.title || row.test_name),
        inline:row.content_is_preview ? null : writingContent(row)
      })).filter(row => row.paperId !== null)
    }
    if (operation === 'writingCatalog') return value.books.flatMap(book => book.children
      .filter(test => test.writing?.test_id)
      .map(test => ({id:test.writing.test_id, bookId:book.book_id, title:[book.name,test.name].join(' '),
        task1:test.writing.xiaozuowen?.paper_id ?? null, task2:test.writing.dazuowen?.paper_id ?? null})))
    if (operation === 'readingCatalog' || operation === 'listeningCatalog') {
      const subject = operation === 'readingCatalog' ? 'reading' : 'listening'
      return value.books.flatMap(book => book.children
        .filter(test => test[subject]?.test_id)
        .map(test => ({ id:test[subject].test_id, title:[book.name,test.name].join(' ') })))
    }
    if (operation === 'listeningJijingCatalog') return value.tests.filter(row => row.listening).map(row => ({
      id:row.listening.test_id, title:row.listening.name || row.name,
      parts:row.listening.parts.map(part => pick(part, ['paper_id','title','question_name']))
    }))
    if (operation === 'listeningJijingPart') return listeningPart(value, true)
    if (operation === 'listeningExam' || operation === 'listeningJijingExam') return {
      ...pick(value, ['test_id', 'jianya_name', 'test_name']),
      parts: value.parts.map(part => listeningPart(part, operation === 'listeningJijingExam'))
    }
    if (operation === 'readingSubmit') return null
    if (operation === 'mistakeWords') return {
      ...pick(value, ['current_page', 'per_page', 'last_page', 'total']),
      data: value.data.map(row => ({
        ...pick(row, ['id', 'user_id', 'is_delete']),
        lexicon: row.lexicon == null ? null : pick(row.lexicon, ['id', 'word', 'translate', 'phonetic_transcription', 'example'])
      }))
    }
    if (operation === 'synonymBooks') return value.map(row => pick(row, ['id', 'name', 'pair_count']))
    if (operation === 'synonymChapters') return {
      book: pick(value.book, ['id']),
      categories: value.categories.map(category => ({
        ...pick(category, ['id', 'name']),
        chapters: category.chapters.map(row => pick(row, ['id', 'category_id', 'name', 'pair_count']))
      }))
    }
    if (operation === 'synonymChapter') return {
      book: pick(value.book, ['id']),
      category: pick(value.category, ['id']),
      chapter: pick(value.chapter, ['id']),
      groups: value.groups.map(group => ({
        ...pick(group, ['id', 'chapter_id', 'version', 'pair_count']),
        pairs: group.pairs.map(pair => pick(pair, [
          'id', 'group_id', 'is_delete', 'left_text', 'right_text', 'meaning_zh'
        ]))
      }))
    }
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
    if (operation === 'articleDocument') {
      const completed = new Set(Array.isArray(value.existing_id) ? value.existing_id.map(String) : [])
      return {
        ...pick(value,['total','sentence_mode','canonical_g_id','canonical_c_id','last_key_jingting','existing_id_jingting','last_key','resume_article_id']),
        data:value.data.map(row => {
          const saved = row.practice_state ? row.practice_state.status === 'completed' : completed.has(String(row.id))
          return {
            ...pick(row,['id','g_id','c_id','ac_id','content','translate','grammar_analysis','start_time','end_time','end_time_new',
              'subtitle_alignment_details','long_article_id','short_article_ids','is_answer_sentence','cloze_details','split_audio_url_new','split_audio_url','phonetic']),
            markChoice:row.jingting_state?.choice ?? row.choice,
            markCompleted:row.jingting_state == null ? null : row.jingting_state.status === 'completed',
            collected:Boolean(row.article_content_collect) || Number(row.is_collection) === 1,
            dictation:saved ? {answer:row.error_article ?? '', accuracy:row.practice_state?.accuracy ?? null} : undefined
          }
        })
      }
    }
    if (operation === 'articleCollections') return {
      ...pick(value,['current_page','per_page','last_page','total']),
      data:value.data.map(row=>({
        ...pick(row,['id','user_id']),
        article_content:row.article_content == null ? null : pick(row.article_content,[
          'id','content','translate','start_time','end_time','split_audio_url_new','split_audio_url','phonetic'
        ])
      }))
    }
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
    if (operation === 'readerCollections') return {
      ...pick(value, ['page','total','page_size']),
      items: value.items.map(row => ({
        available:row.available,
        document:pick(row.document,['id','title','subject']),
        sentence:pick(row.sentence,['id','document_version_id','text','translation'])
      }))
    }
    if (operation === 'readerDocument') {
      const anchor = (block, start, end, quote) => JSON.stringify([block,start,end,quote])
      const annotations = (Array.isArray(value.annotations) ? value.annotations : [])
        .filter(item => item && item.available !== false)
      const bookmarks = new Set(annotations.filter(item => item.kind === 'bookmark')
        .flatMap(item => (Array.isArray(item.anchor_segments) ? item.anchor_segments : []).map(segment =>
          anchor(segment.block_key,segment.start,segment.end,segment.quote))))
      const bookmarked = bookmarks.size ? value.blocks.flatMap(block => block.sentences.filter(sentence =>
        bookmarks.has(anchor(block.block_key,sentence.start_offset,sentence.end_offset,
          block.text.slice(sentence.start_offset,sentence.end_offset)))).map(sentence => sentence.id)) : []
      return {
      document: pick(value.document, ['id', 'provider', 'subject', 'source_type', 'source_id',
        'book_number', 'test_number', 'part_number', 'track']),
      version: pick(value.version, ['id', 'document_id', 'version_no', 'title', 'language',
        'word_count', 'reading_seconds', 'sentence_count', 'content_hash', 'formatter_version']),
      blocks: value.blocks.map(block => ({
        ...pick(block, ['id', 'document_version_id', 'block_key', 'type', 'sort', 'label', 'text']),
        sentences: block.sentences.map(row => pick(row, ['id', 'document_version_id', 'block_id',
          'sentence_key', 'sort', 'start_offset', 'end_offset', 'translation', 'grammar_analysis', 'cues']))
      })),
      media: value.media.map(row => pick(row, ['id', 'kind', 'url'])),
      bookmarked,
      sentenceAnnotations: annotations.filter(item => ['highlight','note'].includes(item.kind)
        && item.anchor_segments?.length === 1).map(item => ({
          ...pick(item,['id','client_key','kind','note','lock_version']),
          anchor:item.anchor_segments[0] ? pick(item.anchor_segments[0],['block_key','start','end','quote']) : null
        })),
      progress: value.progress ? pick(value.progress,['block_key','text_offset','lock_version']) : null,
      completedAt: value.completed_at ?? null
      }
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
  const loadPinned = async (url, expectedHash) => {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'force-cache', signal: controller.signal })
    ensureActive()
    if (!response.ok) throw { atlasCode: 'version' }
    const bytes = await response.arrayBuffer()
    ensureActive()
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map(byte => byte.toString(16).padStart(2, '0')).join('')
    ensureActive()
    if (hash !== expectedHash) throw { atlasCode: 'version' }
    return import(url)
  }
  async function writingPrompt(content, rawImage, requireChart) {
    const prompt = expandPrompt(content)
    let image = null
    if (prompt.images.some(src => !src)) throw {atlasCode:'writingImage'}
    const media = [...new Set([String(rawImage || '').trim(), ...prompt.images].filter(Boolean))]
    if (media.length !== 0 || requireChart) {
      if (media.length !== 1) throw {atlasCode:'writingImage'}
      try { image = await loadChart(media[0]) } catch { throw {atlasCode:'writingImage'} }
    }
    return {prompt:prompt.text,image}
  }
  loadPinned(entry, version.hash).then(async module => {
    ensureActive()
    if (Object.hasOwn(synonym, operation)) {
      if (!version.synonym) throw { atlasCode: 'version' }
      const spec = synonym[operation]
      const id = spec.field ? input[spec.field] : undefined
      if (spec.field && (!Number.isSafeInteger(id) || id <= 0)) throw { atlasCode: 'request' }
      const api = await loadPinned(origin + version.synonym.path, version.synonym.hash)
      ensureActive()
      const read = api[spec.exportName]
      if (typeof read !== 'function') throw { atlasCode: 'version' }
      return read(id, controller.signal)
    }
    const post = module[version.post]
    if (typeof post !== 'function') throw { atlasCode: 'version' }
    if (operation === 'articleAudio') return startArticleAudio(input,controller.signal,state)
    const sentenceScore = () => {
      const score = module[version.sentenceScore]
      if (typeof score !== 'function') throw {atlasCode:'version'}
      const value = score(input.reference, input.answer)
      if (typeof value !== 'string' || !/^(?:0\.\d{2}|1\.00)$/.test(value)) throw {atlasCode:'request'}
      return value
    }
    if (operation === 'articleSentenceScore') return sentenceScore()
    if (operation === 'articleCloze') {
      if (!version.cloze) throw {atlasCode:'cloze'}
      const settings = await loadPinned(origin + version.cloze.path, version.cloze.hash)
      ensureActive()
      if (typeof settings.c !== 'function') throw {atlasCode:'cloze'}
      const segments = settings.c(input.sentence, input.categories)
      if (!Array.isArray(segments) || segments.length > 600) throw {atlasCode:'request'}
      return segments.map(segment => pick(segment, ['text','blank','id']))
    }
    if (operation === 'trainingAnswer' || operation === 'trainingFinish' || operation === 'readingSubmit' ||
        operation === 'articleMark' || operation === 'articleCollect' || operation === 'articleDictationSave' ||
        operation === 'readerBookmark' || operation === 'readerProgress' || operation === 'readerCompletion' ||
        operation === 'readerAnnotationSave' || operation === 'readerAnnotationDelete') {
      const account = await post({url:allowed.account,data:{},signal:controller.signal})
      ensureActive()
      if (!input.expectedOwner || String(account.id)!==input.expectedOwner) throw {atlasCode:'account'}
    }
    if (operation === 'readerBookmark') {
      const {document_id,version_id,sentence_id,collected} = input
      return post({url:allowed.readerBookmark,data:{document_id,version_id,sentence_id,collected},signal:controller.signal})
    }
    if (operation === 'readerProgress') {
      const {document_id,block_key,text_offset,lock_version} = input
      return post({url:allowed.readerProgress,data:{document_id,block_key,text_offset,lock_version},signal:controller.signal})
    }
    if (operation === 'readerCompletion') {
      return post({url:allowed.readerCompletion,data:{document_id:input.document_id,completed:true},signal:controller.signal})
    }
    if (operation === 'readerAnnotationSave' || operation === 'readerAnnotationDelete') {
      return post({url:allowed[operation],data:input.request,signal:controller.signal})
    }
    if (operation === 'articleDictationSave') {
      const score = sentenceScore()
      await post({url:allowed.articleDictationSave,data:{
        key:input.key,article_id:input.articleId,type:score==='1.00'?'success':'fail',error_word:input.answer
      },signal:controller.signal})
      return score
    }
    if (operation === 'articleMark') {
      return post({url:allowed.articleMark,data:{article_id:input.articleId,choice:input.choice,key:input.key},signal:controller.signal})
    }
    if (operation === 'articleCollect') {
      if (!/^[1-9]\d{0,14}$/.test(String(input.articleId))) throw {atlasCode:'request'}
      // The no-notes product action supplies no body.
      return post({url:'/api/study/article/v1/collect/add/'+input.articleId,signal:controller.signal})
    }
    if (['readingExam','listeningExam','listeningJijingExam','listeningJijingPart'].includes(operation)) {
      if (!/^[1-9]\d{0,14}$/.test(input.testId)) throw {atlasCode:'request'}
      const path = {
        readingExam:'/api/study/yuedu-zhenti/v1/jianya/test/show/',
        listeningExam:'/api/study/zhenti/v1/test/show/',
        listeningJijingExam:'/api/study/zhenti/v1/jj/test/show/',
        listeningJijingPart:'/api/study/zhenti/v1/jj/part/show/'
      }[operation]
      return post({url:path+input.testId,data:{},signal:controller.signal})
    }
    if (operation === 'speakingTopic') {
      if (!/^[1-9]\d{0,14}$/.test(input.topicId)) throw {atlasCode:'request'}
      return post({url:'/api/study/kouyu-zhenti/v1/show/'+input.topicId,data:{},signal:controller.signal})
    }
    if (operation === 'writingExam') {
      if (!/^[1-9]\d{0,14}$/.test(input.testId) || !['task1','task2'].includes(input.task)) throw {atlasCode:'request'}
      const result = await post({url:'/api/study/xiezuo-zhenti/v1/test/show/'+input.testId,data:{},signal:controller.signal})
      ensureActive()
      const part = input.task === 'task1' ? result.xiaozuowen : result.dazuowen
      if (!part || String(result.test_id) !== input.testId ||
          result.book_id !== input.bookId || part.paper_id !== input.paperId) throw {atlasCode:'request'}
      return {testId:result.test_id,bookId:result.book_id,paperId:part.paper_id,
        ...await writingPrompt(part.content,part.img_url,input.task === 'task1')}
    }
    if (operation === 'writingExtraPrompt') {
      const prefix = {general:'xiezuo-g-zhenti',jijing:'xiezuo-jijing'}[input.bank]
      if (!prefix || !['task1','task2'].includes(input.task)) throw {atlasCode:'request'}
      let material = input.inline
      if (!material?.content) {
        if (!/^[1-9]\d{0,14}$/.test(String(input.testId))) throw {atlasCode:'request'}
        const response = await post({url:'/api/study/'+prefix+'/v1/test/show/'+input.testId,data:{},signal:controller.signal})
        ensureActive()
        const result = response.values ?? response
        const part = input.task === 'task1' ? result.xiaozuowen : result.dazuowen
        if (!part || Number(part.paper_id || part.id) !== input.paperId ||
            (result.test_id != null && Number(result.test_id) !== input.testId)) throw {atlasCode:'request'}
        material = writingContent(part)
      }
      return writingPrompt(material.content,material.image,input.task === 'task1')
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
      const foldSpelling = module[version.fold]
      const normalizeNumbers = module[version.numbers]
      if (typeof foldSpelling !== 'function' || typeof normalizeNumbers !== 'function') throw {atlasCode:'version'}
      const list = value => {
        if (Array.isArray(value)) return value
        if (typeof value !== 'string' || !value.trim()) return []
        try { const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed:[] } catch { return [value] }
      }
      const reverse=Object.fromEntries(Object.entries(input.dictionary).map(([key,value])=>[value.toLowerCase(),key]))
      const normalize=value=>foldSpelling(normalizeNumbers(String(value||'').replace(/,/g,''),input.dictionary,reverse),input.word.word.includes(' '))
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
    state.result = { ok: false, error: error?.atlasCode === 'version' ? 'version'
      : status === 401 || /^\/login(?:\/|$)/.test(location.pathname || '') ? 'expired'
      : error?.atlasCode === 'account' ? 'account'
      : ['readerProgress','readerAnnotationSave','readerAnnotationDelete'].includes(operation) &&
        error?.values?.code === 'CONFLICT' ? 'readerConflict'
      : error?.atlasCode === 'cloze' ? 'cloze'
      : error?.atlasCode === 'writingImage' ? 'writingImage' : 'request' }
  }).finally(() => {
    state.ready = true
    if (window.__atlasVocabularyAudioRequest?.cancel===state.cancel) delete window.__atlasVocabularyAudioRequest
    if (window.__atlasArticleAudioRequest?.cancel===state.cancel) delete window.__atlasArticleAudioRequest
  })
  return true
}

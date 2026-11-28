<template>
  <div class="setting-row" data-idictation-account>
    <div class="setting-row__copy"><strong>爱听写</strong><span>连接原站账号，将词书章节加入生词本。</span></div>
    <button class="btn btn-secondary" type="button" @click="dialog.showModal()">连接与同步</button>
    <dialog ref="dialog" class="idictation-dialog" aria-labelledby="idictation-title">
      <header><h2 id="idictation-title">爱听写词书</h2><button class="btn btn-ghost" type="button" aria-label="关闭爱听写同步" @click="dialog.close()">×</button></header>
      <p class="field-help">连接后会在后台加载题源。首次使用或登录过期时，在原站窗口登录后回来确认。同步的章节可在生词本中选择和复习。</p>
      <div class="actions">
        <button class="btn btn-secondary" type="button" :disabled="busy" @click="openLogin">打开原站登录</button>
        <button class="btn btn-primary" type="button" :disabled="busy" @click="connect">{{ checking ? '正在验证账号…' : '已登录，连接账号' }}</button>
      </div>
      <template v-if="connected">
        <p>已连接 · {{ memberStatus || '以原站权限为准' }}</p>
        <label>词书范围<select v-model="scope" class="input" :disabled="busy" @change="loadBooks"><option value="mine">我的词书</option><option value="ielts">雅思词书</option></select></label>
        <label>词书<select v-model="bookId" class="input" :disabled="busy" @change="loadChapters"><option value="">选择词书</option><option v-for="book in books" :key="book.id" :value="book.id" :disabled="!book.available">{{ book.title }} · {{ book.wordCount }}词{{ book.available ? '' : '（需原站授权）' }}</option></select></label>
        <label v-if="bookId">章节<select v-model="chapterId" class="input" :disabled="busy"><option value="">选择章节</option><option v-for="chapter in chapters" :key="chapter.id" :value="chapter.id">{{ chapter.title }}</option></select></label>
        <div class="actions">
          <button class="btn btn-primary" type="button" :disabled="busy || !bookId || !chapterId" @click="sync">{{ busy ? '处理中…' : '同步此章节' }}</button>
          <button class="btn btn-secondary" type="button" :disabled="busy" @click="disconnect">断开连接</button>
        </div>
      </template>
      <p v-if="error" role="alert">{{ error }}</p><p v-else-if="notice" role="status">{{ notice }}</p>
    </dialog>
  </div>
</template>
<script setup>
import { ref } from 'vue'
import { idictation } from '@/api/idictation.js'
import { resetReaderLibrary } from './readerLibrary.js'
import { resetArticleLibrary } from './articleLibrary.js'
import { resetReadingLibrary } from './readingLibrary.js'
import { resetListeningLibrary } from './listeningLibrary.js'
const dialog=ref(null),busy=ref(false),connected=ref(false),memberStatus=ref(''),error=ref(''),notice=ref('')
const checking=ref(false)
const scope=ref('mine'),books=ref([]),chapters=ref([]),bookId=ref(''),chapterId=ref('')
function resetLibraries() {
  resetReaderLibrary()
  resetArticleLibrary()
  resetReadingLibrary()
  resetListeningLibrary()
}
async function run(action) {
  if(busy.value)return
  busy.value=true;error.value='';notice.value=''
  try {await action()} catch(e){resetLibraries();connected.value=false;books.value=[];chapters.value=[];bookId.value='';chapterId.value='';error.value=e?.message||String(e)} finally{busy.value=false}
}
function openLogin(){return run(()=>idictation.openLogin())}
async function refreshBooks(){books.value=[];chapters.value=[];bookId.value='';chapterId.value='';books.value=await idictation.books(scope.value)}
function connect(){return run(async()=>{
  resetLibraries()
  connected.value=false
  checking.value=true
  try {
    const status=await idictation.connect()
    connected.value=status.connected
    memberStatus.value=status.memberStatus
  } finally {
    checking.value=false
  }
  try {await refreshBooks()}
  catch(e){error.value=`账号已验证，词书目录加载失败：${e?.message||String(e)}`}
})}
function loadBooks(){return run(refreshBooks)}
function loadChapters(){return run(async()=>{chapters.value=[];chapterId.value='';if(bookId.value)chapters.value=await idictation.chapters(bookId.value)})}
function sync(){return run(async()=>{const result=await idictation.syncChapter(bookId.value,chapterId.value);notice.value=`已同步 ${result.imported} 个词条。打开生词本，选择这本词书即可复习。`})}
function disconnect(){return run(async()=>{await idictation.disconnect();resetLibraries();connected.value=false;books.value=[];chapters.value=[];bookId.value='';chapterId.value='';notice.value='已断开同步连接，已同步的词书仍保留。原站登录由登录窗口管理；需要退出账号时请在原站操作。'})}
</script>
<style scoped>
.idictation-dialog{width:min(36rem,90vw);margin:auto;border:1px solid var(--anth-rule);border-radius:var(--anth-radius-card);background:var(--anth-surface);color:var(--anth-ink);padding:1.5rem;box-shadow:var(--anth-shadow-2)}
.idictation-dialog::backdrop{background:var(--anth-scrim)}
header,.actions{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}header{justify-content:space-between}label{display:grid;gap:.4rem;margin:1rem 0}select{max-width:100%;width:100%}.actions{margin:1rem 0}
</style>

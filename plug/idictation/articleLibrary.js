import { computed,ref } from 'vue'
import { idictation } from '@/api/idictation.js'
export const articleBooks=ref([]),articleBook=ref(''),articleRows=ref([]),articleBusy=ref(false),articleError=ref(''),articleMode=ref('short')
let generation=0
export function resetArticleLibrary(){generation++;articleBooks.value=[];articleBook.value='';articleRows.value=[];articleBusy.value=false;articleError.value=''}
async function load(action){
  if(articleBusy.value)return
  const current=++generation;articleBusy.value=true;articleError.value='';articleRows.value=[]
  try{await action(current)}catch(error){if(current===generation)articleError.value=error?.message||String(error)}
  finally{if(current===generation)articleBusy.value=false}
}
export function loadArticleBooks(){return load(async current=>{
  articleBooks.value=[];articleBook.value='';const books=await idictation.articleBooks()
  if(current===generation)articleBooks.value=books
})}
export function loadArticleChapters(){return load(async current=>{
  if(!articleBook.value)return
  const rows=await idictation.articleChapters(articleBook.value)
  if(current===generation)articleRows.value=rows
})}
export const articleCards=computed(()=>articleRows.value.map(row=>({...row,chapterId:row.id,id:`idictation:article:${row.id}`,
  provider:'idictation',source:'爱听写',practiceKind:'material',activity:'listening',
  sourceTags:[articleBooks.value.find(b=>b.id===row.bookId)?.title||'精听',row.shortCount?`${row.shortCount} 短句`:'文章']})))
export async function openArticle(item){const current=generation;const assetId=await idictation.openArticle(item.chapterId,articleMode.value)
  if(current!==generation)throw new Error('精听目录已改变，请重新选择章节')
  return {name:'PracticeListening',params:{assetId}}
}

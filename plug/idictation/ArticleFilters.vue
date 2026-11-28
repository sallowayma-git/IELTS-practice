<template>
  <div class="article-filters" data-idictation-article>
    <button class="btn btn-secondary" type="button" :disabled="articleBusy" @click="loadArticleBooks">{{ articleBusy ? '加载中…' : '加载雅思精听书目' }}</button>
    <button class="btn btn-secondary" type="button" :disabled="collectionsBusy" @click="openCollections">
      {{ collectionsBusy ? '正在读取收藏…' : '打开精听收藏' }}
    </button>
    <label v-if="articleBooks.length">书目 <select v-model="articleBook" class="select" :disabled="articleBusy" @change="loadArticleChapters"><option value="">选择书目</option><option v-for="book in articleBooks" :key="book.id" :value="book.id" :disabled="!book.available">{{ book.title }}{{ book.available ? '' : '（需原站授权）' }}</option></select></label>
    <label>分句 <select v-model="articleMode" class="select" :disabled="articleBusy"><option value="short">短句</option><option value="long">长句</option></select></label>
    <p v-if="articleError" role="alert">{{ articleError }} <router-link :to="{name:'Settings'}">前往设置连接账号</router-link></p>
    <p v-else role="status">连接爱听写后选择章节，播放原音并查看逐句翻译。</p>
    <p v-if="collectionsError" role="alert">{{ collectionsError }}</p>
  </div>
</template>
<script setup>
import { onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { idictation } from '@/api/idictation.js'
import {articleBooks,articleBook,articleBusy,articleError,articleMode,loadArticleBooks,loadArticleChapters} from './articleLibrary.js'
const router = useRouter()
const collectionsBusy = ref(false)
const collectionsError = ref('')
let active = true

async function openCollections() {
  if (collectionsBusy.value) return
  collectionsBusy.value = true
  collectionsError.value = ''
  try {
    const assetId = await idictation.articleCollections(1)
    if (active) await router.push({ name: 'PracticeListening', params: { assetId } })
  } catch (failure) {
    if (active) collectionsError.value = failure?.message || String(failure)
  } finally {
    if (active) collectionsBusy.value = false
  }
}

onBeforeUnmount(() => { active = false })
</script>
<style scoped>.article-filters{display:flex;align-items:center;gap:.7rem;flex-wrap:wrap}.article-filters label{display:flex;align-items:center;gap:.4rem}.article-filters p{flex-basis:100%;margin:0}</style>

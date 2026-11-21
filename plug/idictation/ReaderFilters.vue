<template>
  <div class="reader-filters" data-idictation-reader>
    <label>类别 <select v-model="readerTrack" class="select" :disabled="readerBusy" @change="resetReaderLibrary"><option value="a">A 类</option><option value="g">G 类</option></select></label>
    <label>书册 <select v-model="readerBook" class="select" :disabled="readerBusy" @change="resetReaderLibrary"><option v-for="book in books" :key="book" :value="book">剑桥 {{ book }}</option></select></label>
    <button class="btn btn-secondary" type="button" :disabled="readerBusy" @click="loadReaderCatalog(1)">{{ readerBusy ? '加载中…' : '加载精读目录' }}</button>
    <template v-if="readerTotal > readerPageSize">
      <button class="btn btn-text" type="button" :disabled="readerBusy || readerPage <= 1" @click="loadReaderCatalog(readerPage - 1)">上一页</button>
      <span>{{ readerPage }} / {{ Math.ceil(readerTotal / readerPageSize) }}</span>
      <button class="btn btn-text" type="button" :disabled="readerBusy || readerPage * readerPageSize >= readerTotal" @click="loadReaderCatalog(readerPage + 1)">下一页</button>
    </template>
    <p v-if="readerError" role="alert">{{ readerError }} <router-link :to="{name:'Settings'}">前往设置连接账号</router-link></p>
    <p v-else role="status">精读文章支持原文与逐句翻译；在设置中连接爱听写后加载。</p>
  </div>
</template>
<script setup>
import { readerBusy, readerError, readerTrack, readerBook, readerPage, readerTotal, readerPageSize, loadReaderCatalog, resetReaderLibrary } from './readerLibrary.js'
const books = Array.from({length:18}, (_, i) => 21 - i)
</script>
<style scoped>
.reader-filters{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;width:100%}.reader-filters label{display:flex;gap:.4rem;align-items:center}.reader-filters p{margin:0;flex-basis:100%}
</style>

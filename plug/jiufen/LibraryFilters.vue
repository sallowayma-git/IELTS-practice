<template>
  <div class="library-filters" aria-label="题库筛选">
    <label>题源 <select v-model="source" class="select" aria-label="题源"><option value="all">全部题源</option><option value="local">本地题库</option><option value="jiufen">九分学长</option></select></label>
    <div class="segmented" aria-label="Part 筛选"><button v-for="v in ['all', ...parts]" :key="v" class="segmented-item" :class="{active:part===v}" type="button" :aria-pressed="part===v" :data-library-part="v" @click="part=v">{{ v==='all'?'全部':v }}</button></div>
  </div>
  <p v-if="syncing || libraryError" role="status">{{ syncing?'正在同步九分学长题目目录…':libraryError }} <button v-if="libraryError && !syncing" type="button" class="btn btn-text" @click="syncLibrary">重试</button></p>
</template>
<script setup>
import {syncLibrary,syncing,libraryError} from './library.js'
defineProps({parts:{type:Array,required:true}})
const source=defineModel('source',{required:true}),part=defineModel('part',{required:true})
</script>
<style scoped>.library-filters{display:flex;align-items:center;justify-content:flex-end;gap:1rem;flex-wrap:wrap;margin-left:auto}.library-filters label{display:flex;align-items:center;gap:.4rem;white-space:nowrap}</style>

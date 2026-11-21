<template>
  <ArticleMaterial v-if="isIdictationArticle(assetId)" :key="assetId" :asset-id="assetId" />
  <ListeningExamPage v-else :asset-id="assetId" :attempt-id="attemptId" />
</template>
<script setup>
import { isIdictationArticle } from '@/api/idictation.js'
import ArticleMaterial from '../../../../plug/idictation/ArticleMaterial.vue'
import ListeningExamPage from './ListeningExamPage.vue'
defineProps({assetId:{type:String,required:true},attemptId:{type:String,default:''}})
</script>

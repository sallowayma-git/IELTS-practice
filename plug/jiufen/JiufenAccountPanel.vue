<template>
  <div class="setting-row" data-jiufen-account>
    <div class="setting-row__copy"><strong>九分学长登录</strong><span v-if="connected">已登录</span></div>
    <button class="btn btn-secondary" type="button" @click="show">{{ connected ? '账号' : '登录' }}</button>
    <dialog ref="dialog" class="login-dialog" aria-labelledby="jiufen-login-title" @close="code = ''; error = ''">
      <header><h2 id="jiufen-login-title">九分学长登录</h2><button type="button" class="btn btn-ghost" aria-label="关闭" @click="dialog.close()">×</button></header>
      <button v-if="connected" type="button" class="btn btn-secondary" :disabled="busy" @click="logout">退出登录</button>
      <form v-else @submit.prevent="login">
        <label>邮箱<input v-model.trim="email" type="email" class="input" required autocomplete="email" autofocus /></label>
        <label>验证码<span class="code-row"><input v-model="code" class="input" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required />
          <button class="btn btn-secondary" type="button" :disabled="busy || cooldown > 0 || !email" @click="send">{{ cooldown ? `${cooldown} 秒` : '发送验证码' }}</button></span></label>
        <button class="btn btn-primary" type="submit" :disabled="busy || !/^\d{6}$/.test(code)">登录</button>
      </form>
      <p v-if="error" role="alert">{{ error }}</p><p v-else-if="notice" role="status">{{ notice }}</p>
    </dialog>
  </div>
</template>
<script setup>
import {ref,onUnmounted} from 'vue'
import {jiufen} from '@/api/jiufen.js'
import {connected,resetLibrary,syncLibrary} from './library.js'
const dialog=ref(null), email=ref(''), code=ref(''), busy=ref(false), error=ref(''), notice=ref(''), cooldown=ref(0)
let timer
function show() {notice.value=''; dialog.value.showModal()}
async function run(action) {
  if (busy.value) return
  busy.value=true; error.value=''; notice.value=''
  try {await action()} catch(e){error.value=e?.message || String(e)} finally {busy.value=false}
}
function send() {return run(async()=>{
  const result=await jiufen.send(email.value)
  notice.value=result.sent?'验证码已发送，请查收邮箱。':'请稍后重新发码。'
  const until=Date.now()+result.cooldownSeconds*1000
  function tick(){cooldown.value=Math.max(0,Math.ceil((until-Date.now())/1000)); if(!cooldown.value)clearInterval(timer)}
  clearInterval(timer);tick();timer=setInterval(tick,1000)
})}
function login(){return run(async()=>{
  await jiufen.login(email.value,code.value);resetLibrary();connected.value=true;dialog.value.close();void syncLibrary()
})}
function logout(){return run(async()=>{await jiufen.logout();resetLibrary();email.value='';dialog.value.close()})}
onUnmounted(()=>clearInterval(timer))
</script>
<style scoped>
.login-dialog{width:min(26rem,90vw); margin:auto; border:1px solid var(--anth-rule); border-radius:var(--anth-radius-card); background:var(--anth-surface); color:var(--anth-ink); padding:1.5rem;box-shadow:var(--anth-shadow-2)}
.login-dialog::backdrop{background:var(--anth-scrim)}
header,.code-row{display:flex;align-items:center;gap:.6rem}header{justify-content:space-between;margin-bottom:1rem}form,label{display:grid;gap:.55rem}form{gap:1rem}.code-row input{min-width:0;flex:1}
</style>

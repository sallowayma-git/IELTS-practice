// Local-only Vite harness; no production hooks, API requests, or user database.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
const root=fileURLToPath(new URL('../../../',import.meta.url))
const app=resolve(root,'apps/writing-vue')
const require=createRequire(resolve(app,'package.json'))
const {createServer}=await import(pathToFileURL(require.resolve('vite')).href)
const payload=JSON.parse(readFileSync(resolve(root,'developer/tests/e2e/reports/idictation-reader-preview.json'),'utf8'))
const mock=`
const payload=${JSON.stringify(payload)};
const asset={id:'idictation-material-preview',title:payload.meta.title,activity:'reading',category:'P1',schemaVersion:2,fingerprint:'preview',metadata:{practiceKind:'material'}};
const calls=[];
const invoke=async(command,args)=>{
  calls.push(command);
  const status=document.getElementById('preview-commands');
  if(status)status.textContent=JSON.stringify(calls);
  if(command==='idictation_reader_payload')return {asset,payload};
  if(command==='idictation_reader_catalog')return {items:[{id:'2',title:asset.title,book:21,test:1,part:1,track:'a'}],page:1,total:1,pageSize:24};
  if(command==='idictation_open_reader')return asset.id;
  if(command==='jiufen_restore'||command==='jiufen_is_connected')return false;
  if(command==='list_settings'||command==='reading_list_assets')return {ok:true,data:[]};
  if(command==='list_history')return {ok:true,data:{items:[],total:0}};
  if(/draft|memorize|endless|submit|timer_|annotation/.test(command))throw new Error('Material invoked forbidden command: '+command);
  return {ok:true,data:null};
};
window.__TAURI__={core:{invoke}};window.__TAURI_INTERNALS__={invoke};
document.addEventListener('DOMContentLoaded',()=>{const status=document.createElement('output');status.id='preview-commands';status.style.cssText='position:fixed;bottom:0;font-size:9px;z-index:9999;background:#fff;color:#333;max-width:100vw';status.textContent=JSON.stringify(calls);document.body.append(status);});
`
const server=await createServer({root:app,configFile:resolve(app,'vite.config.js'),server:{host:'127.0.0.1',port:5178,strictPort:true},
  plugins:[{name:'reader-qa',transformIndexHtml:{order:'pre',handler:()=>[{tag:'script',children:mock,injectTo:'head-prepend'}]}}]})
await server.listen()
console.log('Reader visual harness http://127.0.0.1:5178/#/reading/idictation-material-preview')

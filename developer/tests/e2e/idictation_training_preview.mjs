// Local UI verification only: synthetic transport, no remote site or user DB.
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
const root=fileURLToPath(new URL('../../../',import.meta.url)), app=resolve(root,'apps/writing-vue')
const require=createRequire(resolve(app,'package.json'))
const {createServer}=await import(pathToFileURL(require.resolve('vite')).href)
const mock=`
const calls=[];
let mode=1,number=0;
const prompt=()=>({sessionId:'preview-'+mode,promptId:'word-'+number,mode,total:1,completed:number,remaining:1-number,
  word:mode===4?'major':null,definition:mode===3?'adj. 主要的':null,options:mode===2||mode===4?[{label:'n. 市长'},{label:'adj. 主要的'},{label:'n. 饲槽'},{label:'n. 测量'}]:[],hasAudio:true,hasSentenceAudio:false});
const invoke=async(command,args)=>{
  calls.push(command);const status=document.getElementById('preview-commands');if(status)status.textContent=JSON.stringify(calls);
  if(command==='jiufen_restore'||command==='jiufen_is_connected')return false;
  if(command==='list_settings')return {ok:true,data:[]};
  if(command==='list_history')return {ok:true,data:{items:[],total:0}};
  if(command==='vocab_books')return [{id:'book',title:'爱听写示例词书',provider:'idictation',wordCount:1,unitCount:1}];
  if(command==='vocab_book_units')return [{id:'unit',title:'DAY 9',wordCount:1}];
  if(command==='vocab_book_words')return [{id:'local-word',term:'major',definition:'adj. 主要的',review:{}}];
  if(command==='vocab_list')return {ok:true,data:[]};
  if(command==='idictation_training_start'){mode=args.mode;number=0;return prompt()}
  if(command==='idictation_training_audio'||command==='idictation_training_close')return;
  if(command==='idictation_training_answer'){number++;return {correct:true,word:'major',definition:'adj. 主要的',next:prompt()}}
  if(command==='idictation_training_finish')return {accuracy:100};
  if(command==='vocab_review')throw new Error('Online training must not alter SM-2');
  return {ok:true,data:null};
};
window.__TAURI__={core:{invoke}};window.__TAURI_INTERNALS__={invoke};
document.addEventListener('DOMContentLoaded',()=>{const status=document.createElement('output');status.id='preview-commands';status.style.cssText='position:fixed;bottom:0;font-size:9px;z-index:9999;background:#fff;color:#333;max-width:100vw';status.textContent=JSON.stringify(calls);document.body.append(status);});
`
const server=await createServer({root:app,configFile:resolve(app,'vite.config.js'),server:{host:'127.0.0.1',port:5178,strictPort:true},
  plugins:[{name:'training-qa',transformIndexHtml:{order:'pre',handler:()=>[{tag:'script',children:mock,injectTo:'head-prepend'}]}}]})
await server.listen()
console.log('Training preview http://127.0.0.1:5178/#/vocabulary')

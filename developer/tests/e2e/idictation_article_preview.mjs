// Local UI only: real converted text, synthetic media state, no remote or DB.
import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {resolve} from 'node:path'
const root=fileURLToPath(new URL('../../../',import.meta.url)),app=resolve(root,'apps/writing-vue')
const require=createRequire(resolve(app,'package.json'))
const {createServer}=await import(pathToFileURL(require.resolve('vite')).href)
const payload=JSON.parse(readFileSync(resolve(root,'developer/tests/e2e/reports/idictation-article-preview.json'),'utf8'))
for(const part of payload.studyMaterial.parts)for(const para of part.paragraphs)for(const sentence of para.sentences){
  sentence.audio={mediaId:sentence.id+'-mock-audio',kind:'clip',startSeconds:0,endSeconds:null}
}
const mock=`
const payload=${JSON.stringify(payload)};const calls=[];let state=null;
const invoke=async(command,args)=>{
 if(args?.action!=='state'){calls.push({command,action:args?.action});const out=document.getElementById('preview-commands');if(out)out.textContent=JSON.stringify(calls)}
 if(command==='idictation_article_books')return [{id:'444692',title:'剑雅21',available:true}];
 if(command==='idictation_article_chapters')return [{id:'1197472',bookId:'444692',title:'Test 1 Part 1',shortCount:84}];
 if(command==='idictation_open_article')return 'idictation-article-preview';
 if(command==='idictation_article_payload')return {sessionId:'preview',payload};
 if(command==='idictation_article_audio'){
  if(args.action==='play'||args.action==='resume')state={mediaId:args.mediaId,playing:true,currentTime:0,duration:5,start:0,end:null,rate:args.value,error:''};
  if(args.action==='pause'&&state)state.playing=false;
  if(args.action==='close')state=null;
  if(args.action==='seek'&&state)state.currentTime=args.value;
  if(args.action==='rate'&&state)state.rate=args.value;
  return state
 }
 if(command==='jiufen_restore'||command==='jiufen_is_connected')return false;
 if(command==='list_settings'||command==='listening_list_assets')return {ok:true,data:[]};
 if(command==='list_history')return {ok:true,data:{items:[],total:0}};
 if(/draft|submit|timer_|annotation/.test(command))throw new Error('Material invoked forbidden command: '+command);
 return {ok:true,data:null}
};window.__TAURI__={core:{invoke}};window.__TAURI_INTERNALS__={invoke};
document.addEventListener('DOMContentLoaded',()=>{const out=document.createElement('output');out.id='preview-commands';out.style.cssText='position:fixed;bottom:0;font-size:9px;z-index:9999;background:#fff;color:#333';out.textContent=JSON.stringify(calls);document.body.append(out)});
`
const server=await createServer({root:app,configFile:resolve(app,'vite.config.js'),server:{host:'127.0.0.1',port:5178,strictPort:true},
 plugins:[{name:'article-qa',transformIndexHtml:{order:'pre',handler:()=>[{tag:'script',children:mock,injectTo:'head-prepend'}]}}]})
await server.listen();console.log('Article preview http://127.0.0.1:5178/#/listening')

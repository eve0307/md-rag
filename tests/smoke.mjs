import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn,execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import assert from 'node:assert/strict';import http from 'node:http';
const root=process.argv[2]?path.resolve(process.argv[2]):path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const bundled=!!process.argv[2];
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rag-test-中文 space-'));const data=path.join(tmp,'data'),docs=path.join(tmp,'docs');fs.mkdirSync(docs);const file='测试文章_测试作者.md';const original='# 测试文章\n\n**【PDF 第 9 页｜原书第 7 页】**\n\n清朝禁教时期神职人员的培养。\n\n**【PDF 第 10 页｜原书第 8 页】**\n\n清朝禁教时期的另一段材料。';fs.writeFileSync(path.join(docs,file),original);
const mock=http.createServer(async(req,res)=>{let body='';for await(const x of req)body+=x;const b=JSON.parse(body);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:(Array.isArray(b.input)?b.input:[b.input]).map((_,index)=>({index,embedding:[1,0,0,0,0,0,0,0]}))}));});await new Promise(r=>mock.listen(0,'127.0.0.1',r));
const port=23000+Math.floor(Math.random()*15000),base='http://127.0.0.1:'+port,env={...process.env,RAG_DATA_DIR:data,ZVEC_PORT:String(port),RAG_REQUEST_INTERVAL_MS:'0'};let child;let logs='';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function api(route,body){const r=await fetch(base+route,{...(body!==undefined?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});const v=await r.json();assert.ok(r.ok,JSON.stringify(v));return v;}
async function start(){
 if(bundled){const binary=path.join(root,process.platform==='win32'?'runtime/node.exe':'runtime/bin/node');execFileSync(binary,[path.join(root,'scripts/portable-control.mjs'),'start','--no-browser'],{env,timeout:45000});}
 else{child=spawn(process.execPath,[path.join(root,'src/server.mjs')],{env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);}
 for(let i=0;i<120;i++){try{const h=await api('/api/health');if(h.ok)return;}catch{}await delay(200);}throw Error('Server did not start: '+logs);
}
async function stop(){
 const pid=(await api('/api/health')).pid;await api('/api/shutdown',{});for(let i=0;i<100;i++){try{process.kill(pid,0);}catch{return;}await delay(100);}throw Error('Server did not stop');
}
async function ready(){for(let i=0;i<300;i++){const s=await api('/api/state');if(s.libraries[0]?.job?.status==='done')return;if(['paused','partial'].includes(s.libraries[0]?.job?.status))throw Error(JSON.stringify(s.libraries[0].errors));await delay(100);}throw Error('index timeout');}
try{
 await start();assert.equal((await api('/api/state')).settings.hasKey,false);assert.equal((await api('/api/articles')).files.length,0);
 if(bundled){const first=(await api('/api/health')).pid;await start();assert.equal((await api('/api/health')).pid,first);}
 await api('/api/settings',{mode:'keyword'});const id=(await api('/api/libraries',{kind:'folder',path:docs})).added[0].id;await ready();
 let g=(await api('/api/search',{id,query:'清朝禁教',keywordOnly:true})).results[0];assert.ok(g);let r=await api('/api/read',{id,file,chunk:g.matches[0].id,query:'清朝禁教',related:g.matches.map(x=>x.id),locationIndex:1});assert.equal(r.navigation.index,1);assert.equal(r.navigation.total,2);assert.ok(!r.copyText.includes('【PDF'));assert.ok(r.pages.includes('原书第 8 页'));assert.ok(r.hiddenRanges.length);
 await api('/api/settings',{baseUrl:`http://127.0.0.1:${mock.address().port}/v1`,model:'offline-mock',apiKey:'offline-test-only'});await api('/api/update',{id});await ready();const hybrid=await api('/api/search',{id,query:'语义相关的论述'});assert.equal(hybrid.mode,'hybrid');assert.ok(hybrid.results.length);
 await stop();await start();assert.equal((await api('/api/state')).libraries[0].indexed,1);await stop();assert.equal(fs.readFileSync(path.join(docs,file),'utf8'),original);console.log('PASS',process.platform,process.arch,bundled?'packaged runtime':'source','index / keyword / mock semantic / navigation / persistence / source unchanged');
}catch(e){console.error(logs);throw e;}finally{try{await api('/api/shutdown',{});}catch{}if(child&&child.exitCode===null)child.kill();mock.close();fs.rmSync(tmp,{recursive:true,force:true});}

import {validateDocumentLimit,locateKeywords,locateParagraphs} from './locations.mjs';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {DATA_DIR,ROOT,atomicJSON,readJSON} from './config.mjs';
import {engine,stopEngine} from './engine.mjs';
import {chunkMarkdown,normalize,hash,PRESETS,sourceLocation} from './markdown.mjs';
import {embed,fingerprint} from './embedding.mjs';

import {pilot,articleFor,getArticle} from './articles.mjs';

import {markerRanges,cleanText,contentStart} from './page-markers.mjs';

const REG=path.join(DATA_DIR,'libraries.json');
const state=readJSON(REG,{version:1,settings:{mode:'keyword',initialized:false,baseUrl:'',model:'',apiKey:'',dimension:8},libraries:[]});
const scans=new Map();const watchers=new Map();const scheduled=new Map();
const queryCache=new Map();
const queue=[];let running=null;let shuttingDown=false;let picker=false;
const manifestFile=(l,g=l.generation)=>path.join(DATA_DIR,'libraries',l.id,g,'manifest.json');
const vectors=(l,g=l.generation)=>path.join(DATA_DIR,'libraries',l.id,g,'vectors');
const manifest=(l,g=l.generation)=>g?readJSON(manifestFile(l,g),{files:{},preset:l.preset||'standard',fingerprint:'keyword'}):{files:{},preset:l.preset||'standard',fingerprint:null};
const save=()=>atomicJSON(REG,state);
function get(id){const l=state.libraries.find(x=>x.id===id);if(!l)throw new Error('资料集不存在。');return l;}
const inside=(root,full)=>full===root||full.startsWith(root+path.sep);
const overlap=(a,b)=>inside(a,b)||inside(b,a);
function guardSpace(){const stat=fs.statfsSync(DATA_DIR);if(stat.bavail*stat.bsize<64*1024*1024)throw new Error('可用磁盘空间不足，请先释放至少 64MB 后再处理资料。');}
function safeFull(l,rel){const full=path.resolve(l.path,rel);if(!inside(l.path,full)||full===l.path||! /\.(md|markdown)$/i.test(full))throw new Error('文件不在已选择的资料范围。');const real=fs.realpathSync(full);if(!inside(l.path,real))throw new Error('不读取指向资料集之外的链接。');return full;}
async function readSource(l,rel){const file=safeFull(l,rel);const stat=await fsp.stat(file);if(stat.size>(Number(process.env.RAG_FILE_MAX_BYTES)||32*1024*1024))throw new Error('此文件超过 32MB，请先拆成较小的 Markdown 文件。');return normalize(new TextDecoder('utf-8',{fatal:true}).decode(await fsp.readFile(file)));}
export async function scan(id){
 const l=get(id);let info;
 try{
  const root=await fsp.stat(l.path);if(!root.isDirectory())throw new Error('原文件夹不可用');
  const files=[];let count=0;
  const walk=async dir=>{const d=await fsp.opendir(dir);for await(const e of d){if(e.name.startsWith('.'))continue;const full=path.join(dir,e.name);if(e.isSymbolicLink())continue;if(e.isDirectory()){if(l.kind==='folder')await walk(full);}else if(e.isFile()&&/\.(md|markdown)$/i.test(e.name)){const rel=path.relative(l.path,full).split(path.sep).join('/');if(l.kind==='files'&&!l.selected.includes(rel))continue;const s=await fsp.stat(full);files.push({rel,size:s.size,mtime:s.mtimeMs});}if(++count%200===0)await new Promise(r=>setImmediate(r));}};
  await walk(l.path);files.sort((a,b)=>a.rel.localeCompare(b.rel));info={available:true,files,at:Date.now(),error:null};
 }catch(e){info={available:false,files:[],at:Date.now(),error:'原文件夹无法完整读取，请检查位置或读取权限。'};}
 scans.set(id,info);return summary(l);
}
function summary(l){
 const m=manifest(l);const s=scans.get(l.id);const known=m.files;const files=s?.available?s.files:[];const present=new Set(files.map(f=>f.rel));
 const changed=files.filter(f=>!known[f.rel]||known[f.rel].size!==f.size||known[f.rel].mtime!==f.mtime||known[f.rel].error);
 const removed=s?.available?Object.keys(known).filter(rel=>!present.has(rel)):[];
 const incompatible=state.settings.mode==='cloud'&&!!l.generation&&(m.fingerprint!==fingerprint(state.settings));
 const j=l.job;
 return {id:l.id,name:l.name,path:l.path,kind:l.kind,preset:l.preset||'standard',available:s?.available??null,error:s?.error||null,total:s?.available?files.length:Object.keys(known).length,indexed:Object.keys(known).length,chunks:Object.values(known).reduce((n,f)=>n+(f.ids?.length||0),0),pending:incompatible?files.length:new Set([...changed.map(f=>f.rel),...removed,...(l.errors||[]).map(e=>e.file)]).size,incompatible,mode:!m.fingerprint||m.fingerprint.startsWith('keyword')?'keyword':'cloud',hasIndex:!!l.generation,job:j?{status:j.status,total:j.total||0,done:j.done||0,failed:j.failed||0,file:j.file||'',message:j.message||'',preset:j.preset}:null,errors:(l.errors||[]).slice(0,20)};
}
export function publicState(){const s=state.settings;return {settings:{mode:s.mode,initialized:s.initialized,baseUrl:s.baseUrl,model:s.model,hasKey:!!s.apiKey},libraries:state.libraries.map(summary),busy:!!running,picker};}
export async function setSettings(body){
 if(running||queue.length)throw new Error('请先暂停资料处理，再修改服务设置。');
 if(body.mode==='keyword'){state.settings={...state.settings,mode:'keyword',initialized:true};save();return publicState();}
 const base=String(body.baseUrl||'').trim().replace(/\/+$/,'').replace(/\/embeddings$/i,'');
 let u;try{u=new URL(base);}catch{throw new Error('请填写完整的服务地址。');}if(!['http:','https:'].includes(u.protocol))throw new Error('服务地址必须为 http 或 https。');
 const next={mode:'cloud',initialized:true,baseUrl:base,model:String(body.model||'').trim(),apiKey:body.apiKey?.trim()||state.settings.apiKey||'',dimension:null};
 if(!next.model)throw new Error('请填写模型名称。');
 const vs=await embed(['资料检索连接测试'],next);next.dimension=vs[0].length;state.settings=next;save();return publicState();
}
function watch(l){
 watchers.get(l.id)?.close();watchers.delete(l.id);
 try{const w=fs.watch(l.path,{recursive:l.kind==='folder'},()=>{clearTimeout(scheduled.get(l.id));const t=setTimeout(()=>{scheduled.delete(l.id);void scan(l.id).catch(()=>{});},1500);t.unref();scheduled.set(l.id,t);});w.on('error',()=>{void scan(l.id).catch(()=>{});});watchers.set(l.id,w);}catch{}
}
export async function addSources(body){
 const choices=body.kind==='files'?body.paths:[body.path];if(!Array.isArray(choices)||!choices.length)throw new Error('请选择文件夹或 Markdown 文件。');
 const groups=new Map();
 for(const raw of choices){const real=await fsp.realpath(String(raw));const stat=await fsp.stat(real);if(body.kind==='files'){if(!stat.isFile()||! /\.(md|markdown)$/i.test(real))throw new Error('请选择 Markdown 文件。');const dir=path.dirname(real);if(!groups.has(dir))groups.set(dir,[]);groups.get(dir).push(path.basename(real));}else{if(!stat.isDirectory())throw new Error('请选择文件夹。');groups.set(real,[]);}}
 const chosenDirs=[...groups.keys()];
 for(let i=0;i<chosenDirs.length;i++)for(let j=i+1;j<chosenDirs.length;j++)if(overlap(chosenDirs[i],chosenDirs[j]))throw new Error('所选文件来自父子目录，请选择它们共同的资料文件夹。');
 for(const dir of groups.keys()){
  if(inside(ROOT,dir)||inside(dir,ROOT))throw new Error('请不要把软件自身目录作为资料集，选择存放文献的文件夹。');
  const conflict=state.libraries.find(l=>l.path!==dir&&overlap(l.path,dir));if(conflict)throw new Error('所选目录与资料集「'+conflict.name+'」重叠，请使用已有资料集。');
 }
 const added=[];
 for(const [dir,files] of groups){
  let l=state.libraries.find(l=>l.path===dir);let existing=!!l;let modified=false;
  if(l){if(l.job&&['running','queued'].includes(l.job.status))throw new Error('该资料集正在处理，请稍后再添加文件。');if(body.kind!=='files'&&l.kind==='files'){l.kind='folder';l.selected=[];modified=true;}else if(l.kind==='files'){const before=l.selected.length;l.selected=[...new Set([...l.selected,...files])];modified=l.selected.length!==before;}}
  else {l={id:crypto.randomBytes(8).toString('hex'),name:state.libraries.some(x=>x.name===path.basename(dir))?path.basename(dir)+' · '+path.basename(path.dirname(dir)):path.basename(dir),path:dir,kind:body.kind==='files'?'files':'folder',selected:[...new Set(files)],preset:'standard',generation:null,job:null,errors:[]};state.libraries.push(l);modified=true;}
  save();watch(l);await scan(l.id);if(modified)await update(l.id,{});added.push({id:l.id,existing});
 }
 return {added,state:publicState()};
}
export async function relocate(id,dir){
 const l=get(id);if(l.job&&['running','queued'].includes(l.job.status))throw new Error('请先暂停处理，再重新定位文件夹。');
 const real=await fsp.realpath(dir);if(!(await fsp.stat(real)).isDirectory())throw new Error('请选择原来的资料文件夹。');
 const conflict=state.libraries.find(x=>x.id!==id&&overlap(x.path,real));if(conflict)throw new Error('该位置与其他资料集重叠。');
 if(inside(ROOT,real)||inside(real,ROOT))throw new Error('不要选择软件目录。');
 l.path=real;save();watch(l);await scan(id);return publicState();
}
export async function remove(id){
 const l=get(id);if(l.job&&['running','queued'].includes(l.job.status))throw new Error('请先暂停该资料集的处理。');
 watchers.get(id)?.close();watchers.delete(id);clearTimeout(scheduled.get(id));scheduled.delete(id);
 // The only deleted path is derived from the application's own generated ID.
 await engine('remove',{dir:path.join(DATA_DIR,'libraries',l.id)});state.libraries=state.libraries.filter(x=>x.id!==id);scans.delete(id);save();return publicState();
}
export async function preview(id,preset){
 if(!PRESETS[preset])throw new Error('无效的切分方式。');const l=get(id);await scan(id);const s=scans.get(id);if(!s.available)throw new Error(s.error);
 const examples=[];for(const f of s.files.slice(0,3)){try{const text=await readSource(l,f.rel);const chunks=chunkMarkdown(text,preset);examples.push({file:f.rel,count:chunks.length,chunks:chunks.slice(0,3)});}catch(e){examples.push({file:f.rel,error:e.message});}}
 return {preset,label:PRESETS[preset].label,examples,mode:state.settings.mode};
}
export async function update(id,body={}){
 const l=get(id);if(l.job&&['running','queued'].includes(l.job.status))return publicState();
 if(body.resume&&l.job?.status==='paused'&&l.job.fingerprint===fingerprint(state.settings)){
  l.job.status='queued';l.job.message='等待继续';save();queue.push(id);void pump();return publicState();
 }
 const preset=body.preset||l.preset||'standard';if(!PRESETS[preset])throw new Error('无效的切分方式。');
 await scan(id);const s=scans.get(id);if(!s.available)throw new Error(s.error);
 guardSpace();
 if(l.job?.stage&&l.job.stage!==l.generation){await engine('remove',{dir:path.dirname(vectors(l,l.job.stage))});}
 l.job={status:'queued',preset,stage:'g_'+Date.now()+'_'+crypto.randomBytes(3).toString('hex'),fingerprint:fingerprint(state.settings),total:s.files.length,done:0,failed:0,file:'',message:'等待处理'};save();queue.push(id);void pump();return publicState();
}
export function pause(id){const l=get(id);if(l.job?.status==='queued'){const n=queue.indexOf(id);if(n>=0)queue.splice(n,1);l.job.status='paused';l.job.message='已暂停，可继续';save();}else if(running?.id===id)running.controller.abort();return publicState();}
async function pump(){
 if(running||shuttingDown||!queue.length)return;
 const id=queue.shift();const l=get(id);const controller=new AbortController();running={id,controller};
 try{await build(l,controller.signal);}catch(e){l.job.status='paused';l.job.message=controller.signal.aborted?'已暂停，可继续':e.message;save();}
 finally{running=null;void pump();}
}
async function build(l,signal){
 const job=l.job;job.status='running';job.message='正在准备';save();await scan(l.id);const scanInfo=scans.get(l.id);if(!scanInfo.available)throw new Error(scanInfo.error);
 const s={...state.settings};if(job.fingerprint!==fingerprint(s))throw new Error('服务配置已变化，请重新更新资料。');
 const old=manifest(l);const stageFile=manifestFile(l,job.stage);let next;
 if(fs.existsSync(stageFile))next=readJSON(stageFile,null);
 else{
  const copy=!!l.generation&&old.fingerprint===job.fingerprint&&old.preset===job.preset;
  if(copy)await engine('clone',{from:vectors(l),dir:vectors(l,job.stage)});else await engine('create',{dir:vectors(l,job.stage),dim:s.mode==='cloud'?s.dimension:8});
  next=copy?structuredClone(old):{files:{}};next.schemaVersion=2;next.fingerprint=job.fingerprint;next.preset=job.preset;atomicJSON(stageFile,next);
 }
 const live=new Set(scanInfo.files.map(f=>f.rel));
 for(const rel of Object.keys(next.files))if(!live.has(rel)){await engine('delete',{dir:vectors(l,job.stage),ids:next.files[rel].ids||[]});delete next.files[rel];}
 const errors=[];job.done=0;job.failed=0;job.total=scanInfo.files.length;save();
 for(const file of scanInfo.files){
  if(signal.aborted)throw new Error('处理已暂停');job.file=file.rel;job.message='正在处理';save();
  let attempted=[];
  try{
   const text=await readSource(l,file.rel);const docHash=hash(text);const prev=next.files[file.rel];
   if(prev?.hash===docHash&&!prev.error){next.files[file.rel]={...prev,size:file.size,mtime:file.mtime};}
   else{
    const chunks=chunkMarkdown(text,job.preset);const ids=chunks.map(c=>hash(file.rel+'|'+docHash+'|'+c.start+'|'+c.end).slice(0,40));attempted=ids;
    for(let start=0;start<chunks.length;start+=8){
     if(signal.aborted)throw new Error('处理已暂停');guardSpace();
     const indices=Array.from({length:Math.min(8,chunks.length-start)},(_,i)=>start+i);
     const existing=await engine('fetch',{dir:vectors(l,job.stage),ids:indices.map(i=>ids[i])});
     const fresh=indices.filter(i=>!existing[ids[i]]);if(!fresh.length)continue;
     const input=fresh.map(i=>(chunks[i].heading?chunks[i].heading+'\n':'')+chunks[i].text);const vecs=await embed(input,s,signal);
     await engine('insert',{dir:vectors(l,job.stage),rows:fresh.map((i,k)=>({id:ids[i],vectors:{embedding:vecs[k]},fields:{text:chunks[i].text,file:file.rel,title:path.basename(file.rel),heading:chunks[i].heading,pages:JSON.stringify(chunks[i].pages),docHash,start:chunks[i].start,end:chunks[i].end,line:chunks[i].line}}))});
    }
    const after=await fsp.stat(safeFull(l,file.rel));if(after.size!==file.size||after.mtimeMs!==file.mtime)throw new Error('文件在处理中发生变化，请稍后更新。');
    const keep=new Set(ids);await engine('delete',{dir:vectors(l,job.stage),ids:(prev?.ids||[]).filter(id=>!keep.has(id))});
    next.files[file.rel]={hash:docHash,size:file.size,mtime:file.mtime,ids};
   }
  }catch(e){if(signal.aborted)throw e;const oldIds=new Set(next.files[file.rel]?.ids||[]);for(let i=0;i<attempted.length;i+=256){const freshIds=attempted.slice(i,i+256).filter(id=>!oldIds.has(id));if(freshIds.length){const present=await engine('exists',{dir:vectors(l,job.stage),ids:freshIds});if(present.length)await engine('delete',{dir:vectors(l,job.stage),ids:present});}}errors.push({file:file.rel,error:e.message});job.failed++;if(next.files[file.rel])next.files[file.rel].error=e.message;}
  job.done++;atomicJSON(stageFile,next);save();await new Promise(r=>setImmediate(r));
 }
 if(signal.aborted)throw new Error('处理已暂停');
 atomicJSON(stageFile,next);await engine('close');
 if(errors.length&&l.generation&&(old.fingerprint!==job.fingerprint||old.preset!==job.preset)) {
  l.errors=errors;job.status='paused';job.file='';job.message='新索引尚有失败文件，旧索引保留；点击继续重试';save();return;
 }
 const previous=l.generation;l.generation=job.stage;l.preset=job.preset;l.errors=errors;
 job.status=errors.length?'partial':'done';job.file='';job.message=errors.length?'已完成，部分文件需要重试':'资料已就绪';l.updatedAt=new Date().toISOString();save();
 // Retain one previous generation; remove only older application-generated generations.
 const base=path.join(DATA_DIR,'libraries',l.id);for(const d of await fsp.readdir(base,{withFileTypes:true})){if(d.isDirectory()&&d.name!==l.generation&&d.name!==previous)await engine('remove',{dir:path.join(base,d.name)});}
 await scan(l.id);
}
function validHit(m,h){const f=m.files[h.fields.file];return !!f&&f.hash===h.fields.docHash&&f.ids.includes(h.id);}
function keywordQuality(query,f) {
 const q=query.toLowerCase();const body=f.text.toLowerCase();const title=(f.title+' '+f.heading).toLowerCase();
 const tokens=q.split(/[\s，。！？、,;:!?]+/).filter(Boolean);
 if(body.includes(q))return 5;
 let terms=tokens;if(tokens.length===1&&/^[\u3400-\u9fff]{4,}$/.test(q))terms=Array.from({length:q.length-1},(_,i)=>q.slice(i,i+2));
 if(!terms.length)return 0;
 const textCoverage=terms.filter(t=>body.includes(t)).length/terms.length;
 const anyCoverage=terms.filter(t=>(body+' '+title).includes(t)).length/terms.length;
 if(anyCoverage<.6&&!title.includes(q))return 0;
 return textCoverage*2+anyCoverage+(title.includes(q)?1:0);
}
export async function search(query,id,keywordOnly=false,limit=20,articlePreview=false){
 const documentLimit=validateDocumentLimit(limit);const candidateLimit=Math.max(120,documentLimit*10);let candidatesTruncated=false;
 const q=String(query||'').trim();if(!q||q.length>1000)throw new Error('请输入 1–1000 字的检索内容。');
 const libs=id&&id!=='all'?[get(id)]:state.libraries;const ready=libs.filter(l=>l.generation);const settings={...state.settings};
 let vector=null;let semanticError=null;
 if(!keywordOnly&&settings.mode==='cloud'&&ready.some(l=>manifest(l).fingerprint===fingerprint(settings))){try{const key=fingerprint(settings)+'|'+q;const cached=queryCache.get(key);if(cached&&Date.now()-cached.at<300000)vector=cached.vector;else{vector=(await embed([q],settings))[0];queryCache.set(key,{at:Date.now(),vector});if(queryCache.size>32)queryCache.delete(queryCache.keys().next().value);}}catch(e){semanticError=e.message;}}
 const groups=new Map();const warnings=[];
 for(const l of ready){
  const m=manifest(l);const pilotFiles=articlePreview?pilot().files.filter(x=>x.libraryId===l.id&&m.files[x.file]?.hash===x.hash):[];
  if(articlePreview&&!pilotFiles.length)continue;
  const filter=articlePreview?'file in ('+pilotFiles.map(x=>JSON.stringify(x.file)).join(',')+')':undefined;const dir=vectors(l);const scores=new Map();const rows=new Map();
  try{
   const lists=[];try{const raw=await engine('query',{dir,query:q,limit:candidateLimit,filter});if(raw.length>=candidateLimit)candidatesTruncated=true;lists.push(raw.map(h=>({...h,quality:keywordQuality(q,h.fields)})).filter(h=>h.quality>0).sort((a,b)=>b.quality-a.quality));}catch(e){warnings.push('「'+l.name+'」关键词查询失败：'+e.message);}
   if(vector&&m.fingerprint===fingerprint(settings)){const raw=await engine('query',{dir,vector,limit:candidateLimit,filter});if(raw.length>=candidateLimit)candidatesTruncated=true;lists.push(raw);}
   else if(!keywordOnly&&settings.mode==='cloud'&&m.fingerprint!==fingerprint(settings))warnings.push('「'+l.name+'」需要更新后才能使用当前语义模型。');
   for(const list of lists){let rank=0;for(const h of list){if(!validHit(m,h))continue;rank++;scores.set(h.id,(scores.get(h.id)||0)+1/(60+rank));rows.set(h.id,h);}}
   for(const [key,h] of rows){const f=h.fields;const article=articlePreview?articleFor(pilotFiles.find(x=>x.file===f.file),Number(f.start),Number(f.end)):null;if(articlePreview&&!article)continue;const groupKey=l.id+'|'+f.file+(article?'|'+article.id:'');let group=groups.get(groupKey);if(!group){group={libraryId:l.id,library:l.name,file:f.file,title:article?.title||f.title,article:article?{...article,overlap:undefined}:null,score:0,matches:[],docHash:f.docHash,available:scans.get(l.id)?.available!==false};groups.set(groupKey,group);}const score=scores.get(key)+(h.quality||0)*0.0002;group.score=Math.max(group.score,score);group.matches.push({id:h.id,text:article?f.text.slice(Math.max(0,article.start-Number(f.start)),Math.min(f.text.length,article.end-Number(f.start))):f.text,start:Math.max(Number(f.start),article?.start??0),end:Math.min(Number(f.end),article?.end??Infinity),line:Number(f.line),heading:f.heading,pages:JSON.parse(f.pages||'[]'),score});}
  }catch(e){warnings.push('「'+l.name+'」暂时无法查询：'+e.message);}
 }
 const ordered=[...groups.values()].sort((a,b)=>b.score-a.score);
 const seen=new Map();const results=[];
 for(const g of ordered){g.matches.sort((a,b)=>b.score-a.score);const matches=[];for(const h of g.matches){if(!matches.some(x=>Math.min(x.end,h.end)-Math.max(x.start,h.start)>Math.min(x.end-x.start,h.end-h.start)*.5))matches.push(h);if(matches.length===100)break;}g.matches=matches;
  const dedupKey=g.docHash+(g.article?'|'+g.article.start+'|'+g.article.end:'');const duplicate=seen.get(dedupKey);if(duplicate){duplicate.otherSources.push({library:g.library,file:g.file});continue;}g.otherSources=[];seen.set(dedupKey,g);results.push(g);
 }
 return {results:results.slice(0,documentLimit),limit:documentLimit,candidateDocuments:results.length,hasMore:results.length>documentLimit||candidatesTruncated,articlePreview,mode:vector?'hybrid':'keyword',warnings:[...new Set([...(semanticError?['语义服务暂不可用，已显示关键词结果：'+semanticError]:[]),...warnings])],query:q};
}
export async function readHit(id,rel,chunkId,offset,options={}){
 const l=get(id);const m=manifest(l);const entry=m.files[rel];if(!entry||!entry.ids.includes(chunkId))throw new Error('该命中已更新，请重新检索。');
 const found=await engine('fetch',{dir:vectors(l),ids:[chunkId]});let f=found[chunkId]?.fields;if(!f)throw new Error('命中片段不可用，请重新检索。');
 const cached=(warning)=>({hiddenRanges:markerRanges(f.text),copyText:cleanText(f.text),text:f.text,start:0,end:f.text.length,total:f.text.length,windowStart:0,cached:true,warning,filePath:path.join(l.path,rel),file:rel,heading:f.heading,pages:JSON.parse(f.pages||'[]'),line:f.line,navigation:null});
 let text;try{text=await readSource(l,rel);}catch(e){return cached('当前原文无法读取，显示上次索引的片段；无法跳转到全文。');}
 if(hash(text)!==entry.hash)return cached('原文已变化，显示旧索引片段；请更新资料后再定位。');
 const requested=options.locationIndex;
 if(requested!==undefined&&(!Number.isInteger(requested)||requested<0))throw new Error('命中序号无效。');
 const article=getArticle(id,rel,options.articleId,entry.hash);const bounds=article?{start:article.start,end:article.end}:{};
 if(article){const a=Math.max(Number(f.start),article.start),b=Math.min(Number(f.end),article.end);if(b<=a)throw new Error('片段不属于这篇文章。');f={...f,start:a,end:b,text:text.slice(a,b)};}
 let navigation=locateKeywords(text,options.query,Number(f.start),Number(f.end),requested,bounds);
 if(!navigation&&options.query){
  const allowed=new Set(entry.ids);const ids=[...new Set([chunkId,...(Array.isArray(options.related)?options.related:[])])].filter(x=>allowed.has(x)).slice(0,100);
  const rows=await engine('fetch',{dir:vectors(l),ids});
  navigation=locateParagraphs(Object.entries(rows).map(([id,doc])=>({id,fields:{...doc.fields,start:Math.max(Number(doc.fields.start),article?.start??0),end:Math.min(Number(doc.fields.end),article?.end??Infinity)}})).filter(x=>x.fields.end>x.fields.start),chunkId,requested);
  f=navigation.fields;delete navigation.fields;
 }
 const hitStart=navigation?.start??Number(f.start);const hitEnd=navigation?.end??Number(f.end);
 const viewStart=options.fullIssue?0:(article?.start??0),viewEnd=options.fullIssue?text.length:(article?.end??text.length);
 const begin=offset!==undefined?Math.max(viewStart,Math.min(Number(offset)||0,viewEnd)):Math.max(viewStart,hitStart-2000);const end=Math.min(viewEnd,begin+12000);
 const location=sourceLocation(text,contentStart(text,hitStart,hitEnd));let copyText=text.slice(hitStart,hitEnd);
 if(navigation?.kind==='keyword'){const left=text.lastIndexOf('\n\n',hitStart);const right=text.indexOf('\n\n',hitEnd);const a=Math.max(article?.start??0,left<0?0:left+2);const b=Math.min(article?.end??text.length,right<0?text.length:right);copyText=text.slice(Math.max(a,hitStart-1500),Math.min(b,hitEnd+1500));}
 const highlights=[];if(options.query){const terms=[...new Set(String(options.query).trim().split(/\s+/).filter(Boolean))].sort((a,b)=>b.length-a.length);const escaped=terms.map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));if(escaped.length){const re=new RegExp(escaped.join('|'),'giu');re.lastIndex=begin;let match;while((match=re.exec(text))&&match.index<end){if(match.index+match[0].length<=end)highlights.push({start:match.index-begin,end:match.index+match[0].length-begin});}}}
 return {hiddenRanges:markerRanges(text,begin,end),highlights,article,viewStart,viewEnd,text:text.slice(begin,end),start:Math.min(end-begin,Math.max(0,hitStart-begin)),end:Math.min(end-begin,Math.max(0,hitEnd-begin)),absoluteStart:hitStart,absoluteEnd:hitEnd,total:text.length,windowStart:begin,cached:false,warning:'',filePath:path.join(l.path,rel),file:rel,heading:location.heading,pages:location.pages,line:location.line,copyText:cleanText(copyText),navigation};
}
export function articleCatalog(){
 const p=pilot();return {files:p.files.map(f=>{const l=state.libraries.find(x=>x.id===f.libraryId);const valid=l&&manifest(l).files[f.file]?.hash===f.hash;return {...f,available:!!valid,library:l?.name,articles:f.articles};}),notice:'试分边界待核对；检索复用现有片段向量，尚未按文章边界重新向量化。'};
}
export async function readArticle(id,file,articleId,query=''){
 const l=get(id),m=manifest(l),entry=m.files[file];if(!entry)throw new Error('原文件尚未建立索引。');
 const a=getArticle(id,file,articleId,entry.hash);if(!a)throw new Error('文章不存在。');
 let chunk=null;for(let at=0;at<entry.ids.length&&!chunk;at+=128){const rows=await engine('fetch',{dir:vectors(l),ids:entry.ids.slice(at,at+128)});chunk=Object.entries(rows).sort(([,a],[,b])=>Number(a.fields.start)-Number(b.fields.start)).find(([,d])=>Number(d.fields.end)>a.start&&Number(d.fields.start)<a.end)?.[0];}
 if(!chunk)throw new Error('未找到文章对应的索引片段。');
 return {chunk,reading:await readHit(id,file,chunk,undefined,{query,articleId,locationIndex:query?0:undefined})};
}
export function fileStatus(id){const l=get(id);const s=scans.get(id);const m=manifest(l);return {items:(s?.files||[]).map(f=>({...f,indexed:!!m.files[f.rel],pending:!m.files[f.rel]||m.files[f.rel].size!==f.size||m.files[f.rel].mtime!==f.mtime,error:(l.errors||[]).find(e=>e.file===f.rel)?.error||''})).slice(0,500),errors:l.errors||[]};}
export function setPicker(value){picker=value;}
export async function initialize(){
 fs.mkdirSync(DATA_DIR,{recursive:true});
 for(const l of state.libraries){if(l.job&&['running','queued'].includes(l.job.status)){l.job.status='paused';l.job.message='上次处理中断，点击继续';}watch(l);await scan(l.id);}save();
 const timer=setInterval(()=>{for(const l of state.libraries)void scan(l.id).catch(()=>{});},60000);timer.unref();
}
export async function shutdown(){shuttingDown=true;if(running)running.controller.abort();queue.length=0;for(const l of state.libraries)if(l.job?.status==='queued'){l.job.status='paused';l.job.message='已暂停，可继续';}for(const w of watchers.values())w.close();for(const t of scheduled.values())clearTimeout(t);while(running)await new Promise(r=>setTimeout(r,50));save();await stopEngine();}

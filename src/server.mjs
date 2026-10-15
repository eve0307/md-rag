import './env.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ROOT,DATA_DIR,config} from './config.mjs';
import * as library from './library.mjs';
process.umask(0o077);
const execute=promisify(execFile);const rootId=crypto.createHash('sha256').update(ROOT).digest('hex');
const send=(res,code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
async function body(req){let data='';for await(const part of req){data+=part;if(data.length>1024*1024)throw new Error('请求过大。');}return data?JSON.parse(data):{};}
let stopping=false;let pickerChild=null;
const server=http.createServer(async(req,res)=>{
 const origins=[`http://127.0.0.1:${config.port}`,`http://localhost:${config.port}`];
 if(![`127.0.0.1:${config.port}`,`localhost:${config.port}`].includes(req.headers.host)||req.headers.origin&&!origins.includes(req.headers.origin))return send(res,403,{error:'仅接受本机软件页面的请求。'});
 if(req.method==='POST'&&!String(req.headers['content-type']||'').startsWith('application/json'))return send(res,415,{error:'请使用软件界面提交。'});
 try {
  const u=new URL(req.url,origins[0]);const p=u.pathname;
  if(req.method==='GET'&&p==='/api/health')return send(res,200,{ok:true,service:'md-rag',rootId,pid:process.pid,memory:process.memoryUsage().rss});
  if(req.method==='GET'&&p==='/api/articles')return send(res,200,library.articleCatalog());
  if(req.method==='GET'&&p==='/api/state')return send(res,200,library.publicState());
  if(req.method==='GET'&&p==='/api/files')return send(res,200,library.fileStatus(u.searchParams.get('id')));
  if(req.method==='GET'&&p==='/api/read')return send(res,200,await library.readHit(u.searchParams.get('id'),u.searchParams.get('file'),u.searchParams.get('chunk'),u.searchParams.has('offset')?u.searchParams.get('offset'):undefined));
  if(req.method==='POST'){
   const b=await body(req);
   if(p==='/api/settings')return send(res,200,await library.setSettings(b));
   if(p==='/api/libraries')return send(res,200,await library.addSources(b));
   if(p==='/api/scan')return send(res,200,await library.scan(b.id));
   if(p==='/api/update')return send(res,200,await library.update(b.id,b));
   if(p==='/api/pause')return send(res,200,library.pause(b.id));
   if(p==='/api/remove')return send(res,200,await library.remove(b.id));
   if(p==='/api/relocate')return send(res,200,await library.relocate(b.id,b.path));
   if(p==='/api/preview')return send(res,200,await library.preview(b.id,b.preset));
   if(p==='/api/article-read')return send(res,200,await library.readArticle(b.id,b.file,b.articleId,b.query));
   if(p==='/api/read')return send(res,200,await library.readHit(b.id,b.file,b.chunk,b.offset,{query:b.query,related:b.related,locationIndex:b.locationIndex,articleId:b.articleId,fullIssue:b.fullIssue}));
   if(p==='/api/search')return send(res,200,await library.search(b.query,b.id,b.keywordOnly,b.limit,b.articlePreview===true));
   if(p==='/api/pick'){
    if(library.publicState().picker)throw new Error('文件选择窗口已打开。');library.setPicker(true);
    const kind=b.kind==='files'?'files':'folder';let choices;
    try{const win=process.platform==='win32';const command=win?'powershell.exe':path.join(ROOT,'native/ChooseSource');const args=win?['-NoLogo','-NoProfile','-STA','-Command',fs.readFileSync(path.join(ROOT,'native/choose-windows.ps1'),'utf8')]:[kind];const pending=execute(command,args,{timeout:300000,maxBuffer:1024*1024,env:{...process.env,RAG_PICK_KIND:kind},windowsHide:false});pickerChild=pending.child;const r=await pending;choices=JSON.parse(r.stdout.trim());}
    catch(e){if(stopping)return send(res,200,{cancelled:true});console.error('文件选择窗口：'+e.message);return send(res,200,{needsPath:true});}
    finally{pickerChild=null;library.setPicker(false);}
    if(!choices.length)return send(res,200,{cancelled:true});
    return send(res,200,b.relocate?await library.relocate(b.relocate,choices[0]):await library.addSources(kind==='folder'?{kind,path:choices[0]}:{kind,paths:choices}));
   }
   if(p==='/api/shutdown'){send(res,200,{ok:true});void stop();return;}
  }
  if(req.method==='GET'&&['/','/app.js','/style.css'].includes(p)){
   const file=p==='/'?'index.html':p.slice(1);const mime=file.endsWith('css')?'text/css':file.endsWith('js')?'text/javascript':'text/html';
   res.writeHead(200,{'Content-Type':mime+'; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});fs.createReadStream(path.join(ROOT,'public',file)).pipe(res);return;
  }
  send(res,404,{error:'页面不存在。'});
 }catch(e){console.error(e.message);const friendly=e.code==='ENOENT'?'没有找到该文件或文件夹，请检查原位置。':e.code==='EACCES'||e.code==='EPERM'?'无法读取所选位置，请检查读取权限。':e.code==='ENOSPC'?'磁盘空间不足，请释放空间后重试。':e.message||'操作失败。';send(res,400,{error:friendly});}
});
async function stop(){if(stopping)return;stopping=true;if(pickerChild)pickerChild.kill('SIGTERM');console.log('正在保存进度并关闭索引…');try{await library.shutdown();server.close(()=>process.exit(0));server.closeAllConnections();}catch(e){console.error(e.message);process.exit(1);}}
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
process.on('unhandledRejection',e=>console.error('处理失败：',e.message));
server.on('error',e=>{console.error('服务启动失败：',e.message);void stop();});
fs.mkdirSync(DATA_DIR,{recursive:true});
server.listen(config.port,'127.0.0.1',()=>console.log('资料检索已启动：http://127.0.0.1:'+config.port));
void library.initialize().catch(e=>console.error('资料集读取失败：'+e.message));

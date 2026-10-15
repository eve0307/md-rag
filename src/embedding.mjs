import {hash} from './markdown.mjs';
export const fingerprint=s=>s.mode==='cloud'?hash(JSON.stringify(['md-rag-v2',s.baseUrl,s.model,s.dimension])):'keyword:v2';
let lane=Promise.resolve();let lastAt=0;
const delay=(ms,signal)=>new Promise((resolve,reject)=>{if(signal?.aborted)return reject(new Error('处理已暂停'));const t=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);const abort=()=>{clearTimeout(t);reject(new Error('处理已暂停'));};signal?.addEventListener('abort',abort,{once:true});});
export async function embed(texts,s,signal){
 if(s.mode!=='cloud')return texts.map(()=>[1,...Array(7).fill(0)]);
 const run=async()=>{
  if(signal?.aborted)throw new Error('处理已暂停');
  const wait=Number(process.env.RAG_REQUEST_INTERVAL_MS??1000)-(Date.now()-lastAt);if(wait>0)await delay(wait,signal);lastAt=Date.now();
  for(let retry=0;;retry++){
   const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),Number(process.env.RAG_API_TIMEOUT_MS)||60000);
   const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
   try {
    const r=await fetch(s.baseUrl.replace(/\/+$/,'')+'/embeddings',{method:'POST',headers:{'Content-Type':'application/json',...(s.apiKey?{Authorization:'Bearer '+s.apiKey}:{})},body:JSON.stringify({model:s.model,input:texts,encoding_format:'float'}),signal:controller.signal});
    if((r.status===429||r.status>=500)&&retry<2){await r.text();await delay(800*(retry+1),signal);continue;}
    if(!r.ok)throw new Error('向量服务返回 '+r.status+'，请检查地址、模型、密钥或额度。');
    const body=await r.json();const data=body.data;
    if(!Array.isArray(data)||data.length!==texts.length)throw new Error('向量服务返回数量不匹配。');
    const ordered=data.every(x=>Number.isInteger(x.index))?data.slice().sort((a,b)=>a.index-b.index):data;
    if(ordered.some((x,i)=>Number.isInteger(x.index)&&x.index!==i))throw new Error('向量服务返回顺序不完整。');
    const vectors=ordered.map(x=>x.embedding);
    if(vectors.some(v=>!Array.isArray(v)||v.length<8||v.some(n=>!Number.isFinite(n)))||vectors.some(v=>v.length!==vectors[0].length))throw new Error('向量服务返回无效向量。');
    if(s.dimension&&vectors.some(v=>v.length!==s.dimension))throw new Error('模型返回维度发生变化，请在设置中重新测试后更新资料。');
    return vectors;
   }catch(e){if(signal?.aborted)throw new Error('处理已暂停');if(controller.signal.aborted)throw new Error('向量服务连接超时，可以稍后重试。');throw e;}
   finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
 };
 const result=lane.then(run,run);lane=result.catch(()=>{});return result;
}

import {parentPort} from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import zvec from '@zvec/zvec';
zvec.ZVecInitialize({logLevel:zvec.ZVecLogLevel.ERROR});
let current=null;let currentPath=null;
const fields=['text','file','title','heading','pages','docHash','start','end','line'];
function close() {if(current){current.closeSync();current=null;currentPath=null;}}
function open(dir) {if(currentPath!==dir){close();current=zvec.ZVecOpen(dir,{enableMMAP:true});currentPath=dir;}return current;}
function schema(dim) {
 return new zvec.ZVecCollectionSchema({name:'markdown',fields:[...fields.map(name=>({name,dataType:['start','end','line'].includes(name)?zvec.ZVecDataType.INT64:zvec.ZVecDataType.STRING})),{name:'searchText',dataType:zvec.ZVecDataType.STRING,indexParams:{indexType:zvec.ZVecIndexType.FTS}}],vectors:[{name:'embedding',dataType:zvec.ZVecDataType.VECTOR_FP32,dimension:dim,indexParams:{indexType:zvec.ZVecIndexType.HNSW,metricType:zvec.ZVecMetricType.COSINE,m:16,efConstruction:150}}]});
}
async function run(op,a) {
 if(op==='close'){close();return true;}
 if(op==='create'){close();fs.mkdirSync(path.dirname(a.dir),{recursive:true});current=zvec.ZVecCreateAndOpen(a.dir,schema(a.dim),{enableMMAP:true});currentPath=a.dir;return true;}
 if(op==='clone'){close();fs.cpSync(a.from,a.dir,{recursive:true});return true;}
 if(op==='remove'){close();fs.rmSync(a.dir,{recursive:true,force:true});return true;}
 const col=open(a.dir);
 if(op==='exists'){return Object.keys(col.fetchSync({ids:a.ids,outputFields:[],includeVector:false}));}
 if(op==='fetch'){return col.fetchSync({ids:a.ids,outputFields:fields,includeVector:false});}
 if(op==='insert'){
  const rows=a.rows.map(row=>({...row,fields:{...row.fields,searchText:[row.fields.title,row.fields.heading,row.fields.text].join('\n')}}));
  const r=col.upsertSync(rows);if(r.some(x=>!x.ok))throw new Error('索引写入失败：'+JSON.stringify(r.find(x=>!x.ok)));return r.length;
 }
 if(op==='delete'){if(a.ids.length)col.deleteSync(a.ids);return true;}
 if(op==='query'){
  const args={topk:a.limit||50,outputFields:fields,...(a.filter?{filter:a.filter}:{})};
  if(a.vector)Object.assign(args,{fieldName:'embedding',vector:a.vector,params:{indexType:zvec.ZVecIndexType.HNSW,ef:Math.max(64,(a.limit||50)*4)}});
  else Object.assign(args,{fieldName:'searchText',fts:{queryString:a.query},params:{indexType:zvec.ZVecIndexType.FTS}});
  let r;try{r=await col.query(args);}catch(e){if(!a.vector&&e.message.includes('searchText'))r=await col.query({...args,fieldName:'text'});else throw e;}return r.map(x=>({id:x.id,score:x.score,fields:x.fields}));
 }
 throw new Error('未知数据库操作');
}
let chain=Promise.resolve();
parentPort.on('message',m=>{chain=chain.then(async()=>{try{parentPort.postMessage({id:m.id,result:await run(m.op,m.args)});}catch(e){parentPort.postMessage({id:m.id,error:e.message});}});});

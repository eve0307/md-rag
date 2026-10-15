import {Worker} from 'node:worker_threads';
const worker=new Worker(new URL('./engine-worker.mjs',import.meta.url));
let seq=0;const pending=new Map();let failure=null;
worker.on('message',m=>{const p=pending.get(m.id);if(!p)return;pending.delete(m.id);if(m.error)p.reject(new Error(m.error));else p.resolve(m.result);});
worker.on('error',e=>{failure=e;for(const p of pending.values())p.reject(e);pending.clear();});
worker.on('exit',code=>{if(code){failure=new Error('数据库进程已退出，请重启软件。');for(const p of pending.values())p.reject(failure);pending.clear();}});
export function engine(op,args={}){if(failure)return Promise.reject(failure);return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});worker.postMessage({id,op,args});});}
export async function stopEngine(){await engine('close');await worker.terminate();}

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
export const DATA_DIR = process.env.RAG_DATA_DIR ? path.resolve(process.env.RAG_DATA_DIR) : path.join(ROOT,'data');
export const config = { port: Number(process.env.ZVEC_PORT || 7789), host:'127.0.0.1' };
export function atomicJSON(file, value) {
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 const tmp = file + '.tmp'; fs.writeFileSync(tmp,JSON.stringify(value),{mode:0o600}); fs.renameSync(tmp,file);
}
export function readJSON(file, fallback) { try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch (err) { if(err.code==='ENOENT') return fallback; throw new Error('配置或进度记录无法读取，请保留数据并查看日志：'+path.basename(file)); } }

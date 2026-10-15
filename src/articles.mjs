// Sidecar article boundaries. Source Markdown and existing vectors remain untouched.
import path from 'node:path';
import {DATA_DIR,readJSON} from './config.mjs';
export const pilot=()=>readJSON(path.join(DATA_DIR,'article-pilot.json'),{files:[]});
export function pilotFile(libraryId,file,sourceHash){return pilot().files.find(x=>x.libraryId===libraryId&&x.file===file&&x.hash===sourceHash);}
export function articleFor(file,start,end){return file?.articles.reduce((best,a)=>{const n=Math.max(0,Math.min(end,a.end)-Math.max(start,a.start));return n>(best?.overlap||0)?{...a,overlap:n}:best;},null);}
export function getArticle(libraryId,file,id,sourceHash){if(!id)return null;const a=pilotFile(libraryId,file,sourceHash)?.articles.find(x=>x.id===id);if(!a)throw new Error('文章试分记录已变化，请重新检索。');return a;}

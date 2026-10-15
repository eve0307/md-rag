// Positions refer to normalized source Markdown, never to the search-result preview.
export function validateDocumentLimit(value=20) {
 const n=Number(value);if(!Number.isInteger(n)||n<1||n>100)throw new Error('返回文献数量应为 1–100 的整数。');return n;
}
export function locateKeywords(text,query,anchorStart,anchorEnd,index,bounds={}) {
 const q=String(query||'').trim();if(!q)return null;if(q.length>1000)throw new Error('检索内容不能超过 1000 字。');
 const terms=[...new Set(q.split(/\s+/).filter(Boolean))].sort((a,b)=>b.length-a.length);
 const escaped=terms.map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
 const pattern=new RegExp(escaped.join('|'),'giu');
 const lo=bounds.start??0,hi=bounds.end??text.length;
 let total=0,target=null,nearest=null,within=null,last=null,minDistance=Infinity;let m;
 pattern.lastIndex=lo;
 while((m=pattern.exec(text))&&m.index<hi) {
  if(m.index+m[0].length>hi)continue;
  const location={index:total,start:m.index,end:m.index+m[0].length};last=location;
  if(index!==undefined&&total===index)target=location;
  if(!within&&m.index>=anchorStart&&m.index<anchorEnd)within=location;
  const distance=Math.abs(m.index-anchorStart);if(distance<minDistance){nearest=location;minDistance=distance;}
  total++;
 }
 if(!total)return null;
 if(index!==undefined&&!target)throw new Error('该命中位置不存在，请重新检索。');
 const active=target||within||nearest;
 const pageStart=Math.floor(active.index/30)*30;const markers=[],items=[];const stride=Math.max(1,Math.ceil(total/1000));let ordinal=0;pattern.lastIndex=lo;
 while((m=pattern.exec(text))&&m.index<hi){if(m.index+m[0].length>hi)continue;const x={index:ordinal,start:m.index,end:m.index+m[0].length};if(ordinal%stride===0)markers.push({index:ordinal,start:m.index});if(ordinal>=pageStart&&ordinal<pageStart+30)items.push({...x,excerpt:text.slice(Math.max(lo,x.start-35),Math.min(hi,x.end+55)).replace(/\s+/g,' ')});ordinal++;}
 if(markers.at(-1)?.index!==total-1)markers.push({index:total-1,start:last.start});
 return {...active,total,kind:'keyword',label:(bounds.start!==undefined?'文章':'全文')+'关键词位置'+(terms.length>1?'（任一检索词）':''),
  markers,items,listStart:pageStart};
}
export function locateParagraphs(rows,selectedId,index) {
 const matches=rows.sort((a,b)=>Number(a.fields.start)-Number(b.fields.start));const locations=[];
 for(const row of matches) {
  const f=row.fields;const start=Number(f.start),end=Number(f.end);
  if(locations.some(x=>Math.min(x.end,end)-Math.max(x.start,start)>Math.min(x.end-x.start,end-start)*.5))continue;
  locations.push({id:row.id,start,end,fields:f});
 }
 const chosen=index??Math.max(0,locations.findIndex(x=>x.id===selectedId));
 if(!locations[chosen])throw new Error('该相关段落已更新，请重新检索。');
 return {...locations[chosen],index:chosen,total:locations.length,kind:'paragraph',label:'本次检索的相关段落',markers:locations.map((x,index)=>({index,start:x.start})),items:locations.map((x,index)=>({index,start:x.start,end:x.end,excerpt:x.fields.text.slice(0,100)})),listStart:0};
}

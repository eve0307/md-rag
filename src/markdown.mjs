import crypto from 'node:crypto';
export const PRESETS={fine:{label:'精细',size:450,overlap:60},standard:{label:'标准',size:900,overlap:100},context:{label:'更多上下文',size:1800,overlap:200}};
export const hash = text => crypto.createHash('sha256').update(text).digest('hex');
export const normalize = text => text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
export function markers(line) {
 const out=[];
 const printed=line.match(/(?:原书(?:印刷)?页码|印刷页码|PRINTED_PAGE)\s*[:：=]\s*([\dIVXLCDMivxlcdm]+)(?![\w])/i)||line.match(/(?:原刊|原书|印刷)第\s*([\dIVXLCDMivxlcdm]+)\s*页/i);
 const physical=line.match(/(?:PDF(?:物理)?页码|PDF_PAGE)\s*[:：=]\s*(\d+)/i)||line.match(/PDF\s*第\s*(\d+)\s*页/i);
 if(printed) out.push('原书第 '+printed[1]+' 页'+(/(?:推算|待确认)/.test(line)?'（'+(/推算/.test(line)?'推算':'待确认')+'）':''));
 else if(/原书页码未识别[／/]待确认/.test(line))out.push('原书页码未识别／待确认');
 if(physical) out.push('PDF 第 '+physical[1]+' 页');
 return out;
}
export function chunkMarkdown(raw,preset='standard') {
 const p=PRESETS[preset];if(!p)throw new Error('请选择精细、标准或更多上下文。');
 const text=normalize(raw);const lines=text.split('\n');const sections=[];let heading=[];let pages=[];let start=0;let offset=0;let fenced=false;
 const flush=(end)=>{if(end>start&&text.slice(start,end).trim())sections.push({start,end,heading:heading.filter(Boolean).join(' / '),pages:[...pages]});start=end;};
 for(const line of lines) {
  const fence=/^\s*(```|~~~)/.test(line);
  const title=!fenced&&line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
  const page=!fenced&&/^\s*(?:<!--|\[|#{1,6}\s|\*\*【)/.test(line)?markers(line):[];
  if(title||page.length) {flush(offset); if(title){heading=heading.slice(0,title[1].length-1);heading[title[1].length-1]=title[2];}if(page.length)pages=page;}
  if(fence)fenced=!fenced;
  offset+=line.length+1;
 }
 flush(text.length);
 const lineStarts=[0];for(let i=0;i<text.length;i++)if(text[i]==='\n')lineStarts.push(i+1);
 const lineOf=(at)=>{let lo=0,hi=lineStarts.length;while(lo<hi){const m=(lo+hi)>>1;if(lineStarts[m]<=at)lo=m+1;else hi=m;}return lo;};
 const out=[];
 for(const s of sections) {
  let at=s.start;
  while(at<s.end) {
   while(at<s.end&&/\s/.test(text[at]))at++;
   if(at>=s.end)break;
   let end=Math.min(at+p.size,s.end);
   if(end<s.end) {
    const segment=text.slice(at,end);let cut=segment.lastIndexOf('\n\n');
    if(cut<p.size*.45) {cut=-1;const re=/[。！？；!?;]\s*/g;let m;while((m=re.exec(segment)))if(m.index>p.size*.45)cut=m.index+m[0].length;}
    if(cut>0)end=at+cut;
    // Do not split a UTF-16 surrogate pair.
    if(end<s.end&&/[\uDC00-\uDFFF]/.test(text[end]))end--;
   }
   let trimmedEnd=end;while(trimmedEnd>at&&/\s/.test(text[trimmedEnd-1]))trimmedEnd--;
   const piece=text.slice(at,trimmedEnd);
   if(piece.trim())out.push({text:piece,start:at,end:trimmedEnd,line:lineOf(at),heading:s.heading,pages:s.pages});
   if(end>=s.end)break;
   let next=Math.max(at+1,end-p.overlap);
   const newline=text.slice(next,end).indexOf('\n');if(newline>0)next+=newline+1;
   if(/[\uDC00-\uDFFF]/.test(text[next]))next++;
   at=next;
  }
 }
 return out.filter(c=>c.text.replace(/<!--[\s\S]*?-->/g,'').split('\n').some(line=>line.trim()&&!/^#{1,6}\s/.test(line)&&!/^\s*(```|~~~)\s*$/.test(line)));
}

export function sourceLocation(text,at){
 let heading=[],pages=[],fenced=false,line=1,offset=0;
 while(offset<=at&&offset<text.length){
  const stop=text.indexOf('\n',offset);const end=stop<0?text.length:stop;const value=text.slice(offset,end);
  const title=!fenced&&value.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
  const page=!fenced&&/^\s*(?:<!--|\[|#{1,6}\s|\*\*【)/.test(value)?markers(value):[];
  if(title){heading=heading.slice(0,title[1].length-1);heading[title[1].length-1]=title[2];}if(page.length)pages=page;
  if(/^\s*(```|~~~)/.test(value))fenced=!fenced;
  if(end>=at||stop<0)break;offset=end+1;line++;
 }
 return {heading:heading.filter(Boolean).join(' / '),pages,line};
}

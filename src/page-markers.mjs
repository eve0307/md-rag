// Presentation only: offsets and original source text remain unchanged.
export const markerPattern=()=>/^[\t ]*(?:\*\*[\t ]*)?【[\t ]*PDF[\t ]*第[\t ]*\d+[\t ]*页[^】\r\n]*】[\t ]*(?:\*\*)?[\t ]*(?:\r?\n|$)/gim;
export function markerRanges(text,begin=0,end=text.length){const out=[];for(const m of text.matchAll(markerPattern())){const a=m.index,b=a+m[0].length;if(a<end&&b>begin)out.push({start:Math.max(a,begin)-begin,end:Math.min(b,end)-begin});}return out;}
export function cleanText(text){return String(text??'').replace(markerPattern(),'').replace(/\n{3,}/g,'\n\n').trim();}
export function contentStart(text,start,end){let at=start;for(const r of markerRanges(text,start,end)){while(at<start+r.start&&/\s/.test(text[at]))at++;if(at>=start+r.start&&at<start+r.end)at=start+r.end;else break;}while(at<end&&/\s/.test(text[at]))at++;return at<end?at:start;}

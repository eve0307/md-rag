const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pageMarkerPattern=()=>/^[\t ]*(?:\*\*[\t ]*)?【[\t ]*PDF[\t ]*第[\t ]*\d+[\t ]*页[^】\r\n]*】[\t ]*(?:\*\*)?[\t ]*(?:\r?\n|$)/gim;
function cleanDisplay(text){return String(text??'').replace(pageMarkerPattern(),'').replace(/(?:\*\*[\t ]*)?【[\t ]*PDF[\t ]*第[\t ]*\d+[\t ]*页[^】\r\n]*】[\t ]*(?:\*\*)?/gi,'').replace(/\n{3,}/g,'\n\n').trim();}
function documentInfo(g){
 if(g.article)return {title:g.article.title,author:g.article.author||''};
 const name=String(g.file||g.title||'').split('/').at(-1).replace(/\.(md|markdown)$/i,'');const cut=name.lastIndexOf('_');
 if(cut>0){const author=name.slice(cut+1).trim();if(/^[\p{Script=Han}·、，]{2,16}$/u.test(author))return {title:name.slice(0,cut).replace(/_+$/,''),author};}
 return {title:String(g.title||name).replace(/\.(md|markdown)$/i,''),author:''};
}
let state={libraries:[],settings:{mode:'keyword'}};let hits=[];let selected=null;let reading=null;let searchTicket=0;let sliceId=null;let slicePreset='standard';let toastTimer;let refreshing=false;let activeQuery="";let readTicket=0;let catalog=null;let fullIssue=false;
async function api(route,body){const response=await fetch(route,{...(body!==undefined?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});let data;try{data=await response.json();}catch{throw new Error('服务返回异常，请查看日志。');}if(!response.ok)throw new Error(data.error||'操作失败');return data;}
function toast(message){$('toast').textContent=message;$('toast').classList.add('on');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('on'),5000);}
function notice(messages=[]){$('notices').innerHTML=messages.map(m=>'<div class="notice">'+esc(m)+'</div>').join('');}
function openSettings(){const s=state.settings;$('baseUrl').value=s.baseUrl||'';$('model').value=s.model||'';$('apiKey').value='';$('apiKey').placeholder=s.hasKey?'留空保留已保存的密钥':'填写自己的密钥';$('settingsError').textContent='';$('settingsDialog').showModal();}
function currentLibraries(){const id=$('scope').value;return state.libraries.filter(l=>id==='all'||l.id===id);}
function setButtons(){const empty=!state.libraries.length;$('searchButton').disabled=empty;$('query').disabled=empty;$('manageButton').disabled=empty;$('settingsButton').disabled=state.busy;}
function renderState(){
 const current=$('scope').value;const options='<option value="all">全部资料集</option>'+state.libraries.map(l=>'<option value="'+esc(l.id)+'">'+esc(l.name)+'</option>').join('');
 if($('scope').innerHTML!==options){$('scope').innerHTML=options;if(state.libraries.some(l=>l.id===current))$('scope').value=current;}
 $('libraryCount').textContent=state.libraries.length;$('serviceBadge').textContent=state.settings.mode==='cloud'?'关键词 + 按意思检索':'关键词检索';
 const libs=currentLibraries();const indexed=libs.reduce((n,l)=>n+l.indexed,0);const pending=libs.reduce((n,l)=>n+l.pending,0);const unavailable=libs.filter(l=>l.available===false).length;
 $('indexSummary').textContent=libs.length?indexed+' 份资料已处理'+(pending?' · '+pending+' 项待更新':'')+(unavailable?' · '+unavailable+' 个目录暂不可用':''):'选择资料文件夹开始';
 $('footerState').textContent=state.busy?'正在处理资料，旧索引仍可检索':'本机索引 · '+state.libraries.length+' 个资料集';
 $('jobs').innerHTML=state.libraries.filter(l=>l.job&&['running','queued','paused','partial'].includes(l.job.status)).map(l=>{
  const j=l.job;const active=['running','queued'].includes(j.status);const text=active?(j.status==='queued'?'等待处理':j.file||'正在准备'):j.message;
  return '<div class="job-strip"><span><b>'+esc(l.name)+'</b> · '+esc(text)+' · '+j.done+'/'+j.total+(j.failed?' · '+j.failed+' 份失败':'')+'</span><progress max="'+Math.max(j.total,1)+'" value="'+j.done+'"></progress><button data-job="'+esc(l.id)+'" data-action="'+(active?'pause':j.status==='paused'?'resume':'update')+'">'+(active?'暂停':j.status==='paused'?'继续':'重试失败文件')+'</button></div>';
 }).join('');
 const empty=document.querySelector('.empty-start');if(empty){empty.querySelector('h3').textContent=state.libraries.length?'输入你想找的内容':'你的资料，直接检索';empty.querySelector('p').innerHTML=state.libraries.length?'选择一个资料集，或检索全部资料。<br>命中后直接在右侧阅读原文。':'添加一个文件夹，软件会自动切分并建立索引。<br>原文件留在原处，不用复制到软件中。';$('emptyAdd').hidden=!!state.libraries.length;}
 setButtons();if($('manageDialog').open)renderLibraries();
}
async function refresh(){if(refreshing)return;refreshing=true;try{state=await api('/api/state');renderState();}catch(e){$('footerState').textContent='服务连接断开';}finally{refreshing=false;}}
async function pick(kind,relocate){
 const button=relocate?null:$(kind==='files'?'addFiles':'addFolder');if(button)button.disabled=true;
 try{const r=await api('/api/pick',{kind,relocate});if(r.cancelled)return;if(r.needsPath){openPath(relocate);return;}await refresh();const id=r.added?.[0]?.id||relocate;if(id){$('scope').value=id;renderState();}toast(r.added?.every(x=>x.existing)?'已选择已有资料集':'资料已添加，软件会自动处理。');}
 catch(e){toast(e.message);}finally{if(button)button.disabled=false;}
}
function renderLibraries(){
 $('libraryList').innerHTML=state.libraries.length?state.libraries.map(l=>{
  const busy=l.job&&['running','queued'].includes(l.job.status);let facts=l.indexed+' / '+l.total+' 份资料已处理';if(l.pending)facts+=' · '+l.pending+' 项待更新';if(l.incompatible)facts+=' · 服务已更改，请更新';if(l.available===false)facts+=' · 原文件夹不可用';
  return '<div class="library-card"><h3>'+esc(l.name)+'</h3><div class="library-path">'+esc(l.path)+(l.kind==='files'?' · 仅处理已选择的文件':' · 包含子文件夹')+'</div><div class="library-facts">'+esc(facts)+'</div><div class="library-actions"><button data-library="'+esc(l.id)+'" data-action="'+(busy?'pause':l.job?.status==='paused'?'resume':'update')+'">'+(busy?'暂停处理':l.job?.status==='paused'?'继续处理':'更新资料')+'</button><button data-library="'+esc(l.id)+'" data-action="scan">检查变化</button><button data-library="'+esc(l.id)+'" data-action="slice" '+(busy?'disabled':'')+'>调整切分</button><button data-library="'+esc(l.id)+'" data-action="relocate" '+(busy?'disabled':'')+'>重新定位</button><button class="quiet danger" data-library="'+esc(l.id)+'" data-action="remove" '+(busy?'disabled':'')+'>移除</button></div>'+(l.errors.length?'<div class="errors-list">'+l.errors.map(e=>esc(e.file)+'：'+esc(e.error)).join('<br>')+'</div>':'')+'</div>';
 }).join(''):'<div class="empty-result">还没有资料集。</div>';
}
async function action(id,type){
 try{
  if(type==='slice'){sliceId=id;slicePreset=state.libraries.find(l=>l.id===id)?.preset||'standard';$('manageDialog').close();$('sliceDialog').showModal();await previewSlice(slicePreset);return;}
  if(type==='relocate'){await pick('folder',id);return;}
  if(type==='remove'){const l=state.libraries.find(l=>l.id===id);if(!confirm('移除资料集「'+l.name+'」？软件生成的索引会被清理，原 Markdown 文件不会删除。'))return;await api('/api/remove',{id});if(selected?.libraryId===id){selected=null;reading=null;$('reader').textContent='该资料集已移除。';$('copyButton').disabled=true;}hits=hits.filter(h=>h.libraryId!==id);renderResults();}
  else if(type==='pause')await api('/api/pause',{id});
  else if(type==='scan')await api('/api/scan',{id});
  else await api('/api/update',{id,resume:type==='resume'});
  await refresh();
 }catch(e){toast(e.message);}
}
async function previewSlice(preset){
 slicePreset=preset;document.querySelectorAll('[data-preset]').forEach(b=>b.classList.toggle('active',b.dataset.preset===preset));$('applySlice').disabled=true;$('slicePreview').innerHTML='<div class="empty-result">正在读取少量样本…</div>';
 try{const r=await api('/api/preview',{id:sliceId,preset});if(slicePreset!==preset)return;$('slicePreview').innerHTML=r.examples.length?r.examples.map(e=>'<div class="preview-block"><p>'+esc(e.file)+(e.error?'':' · '+e.count+' 个片段')+'</p>'+(e.error?'<p class="error">'+esc(e.error)+'</p>':e.chunks.slice(0,2).map((c,i)=>'<p>片段 '+(i+1)+(c.heading?' · '+esc(c.heading):'')+'</p><pre>'+esc(c.text)+'</pre>').join(''))+'</div>').join(''):'<div class="empty-result">此资料集没有可预览的 Markdown。</div>';$('applySlice').disabled=!r.examples.some(e=>!e.error);}
 catch(e){$('slicePreview').innerHTML='<p class="error">'+esc(e.message)+'</p>';}
}
function renderResults(){
 if(!hits.length){$('results').innerHTML='<div class="empty-result">暂未找到相关资料。<br>试试更短的关键词、不同说法，或检查资料是否处理完成。</div>';return;}
 $('results').innerHTML=hits.map((g,i)=>{const m=g.matches[0],info=documentInfo(g);return '<article class="result-card'+(selected?.libraryId===g.libraryId&&selected?.file===g.file&&selected?.article?.id===g.article?.id?' selected':'')+'" data-hit="'+i+'" tabindex="0" role="button" aria-label="阅读 '+esc(info.title)+'"><div class="result-head"><h3>'+esc(info.title)+'</h3><span class="rank">'+String(i+1).padStart(2,'0')+'</span></div>'+(info.author?'<div class="author-line">作者：'+esc(info.author)+'</div>':'')+'<span class="source-label">'+esc(g.library)+(g.article?' · '+esc(g.article.type)+' · '+esc(g.article.issueLabel)+' · 边界待核对':(m.heading?' · '+esc(m.heading):''))+'</span><p class="snippet">'+esc(cleanDisplay(m.text))+'</p><div class="result-foot"><span>'+esc(g.article?.pdfPages?.length?'PDF 第 '+g.article.pdfPages[0]+'–'+g.article.pdfPages.at(-1)+' 页':m.pages.join(' · ')||'Markdown 第 '+m.line+' 行')+'</span><span>'+(g.available?'查看原文 →':'查看索引片段 →')+'</span></div>'+(g.matches.length>1?'<div class="more-matches">'+g.matches.slice(0,3).map((_,j)=>'<button data-hit="'+i+'" data-match="'+j+'">片段 '+(j+1)+'</button>').join('')+'</div><div class="related-summary">本次检索返回 '+g.matches.length+' 个相关段落 · 打开后可逐处跳转</div>':'')+(g.otherSources.length?'<p class="small">相同内容另见 '+esc(g.otherSources.map(x=>x.library+' / '+x.file).join('、'))+'</p>':'')+'</article>';}).join('');
}
function scrollToHit(){
 const container=$('reader');const mark=container.querySelector('mark.active-hit');if(!mark||!mark.textContent)return;
 const top=mark.getBoundingClientRect().top-container.getBoundingClientRect().top+container.scrollTop;
 container.scrollTop=Math.max(0,top-Math.min(80,container.clientHeight/4));
}
function renderHitNavigation(){
 const n=reading?.navigation;const usable=!!n&&!reading.cached;
 $('hitNavigation').hidden=!usable;$('hitOverview').hidden=!usable;if(!usable)return;
 $('hitCount').textContent=n.label+' · 第 '+(n.index+1)+' / '+n.total+' 处';
 $('previousHit').disabled=n.index===0;$('nextHit').disabled=n.index>=n.total-1;
 $('hitNumber').max=n.total;$('hitNumber').value=n.index+1;renderOverview();
}
async function read(groupIndex,matchIndex=0,offset,locationIndex,context){
 const g=context||hits[groupIndex];if(!g)return;const m=context?.match||g.matches[matchIndex];if(!m)return;
 const request=++readTicket;selected={...g,match:m,groupIndex,matchIndex};renderResults();reading=null;
 $('readerAuthor').textContent='';$('browseIssue').hidden=true;$('readerTitle').textContent=documentInfo(g).title;$('readerMeta').textContent=g.library+' / '+g.file;$('reader').textContent='正在定位原文…';$('readerWarning').textContent='';$('copyButton').disabled=true;$('hitNavigation').hidden=true;$('hitOverview').hidden=true;
 try{
  const body={id:g.libraryId,file:g.file,chunk:m.id,query:activeQuery,related:g.matches.map(x=>x.id),articleId:g.article?.id,fullIssue};
  if(offset!==undefined)body.offset=offset;if(locationIndex!==undefined)body.locationIndex=locationIndex;
  const r=await api('/api/read',body);if(request!==readTicket)return;
  reading=r;const info=documentInfo(g);$('readerTitle').textContent=g.article?.title||(info.author?info.title:(r.heading||info.title));$('readerAuthor').textContent=info.author?'作者：'+info.author:'';$('browseIssue').hidden=!g.article||r.cached;$('browseIssue').textContent=fullIssue?'只看文章':'查看整期';$('readerWarning').textContent=r.warning;$('readerMeta').textContent=g.library+' · '+(g.article?g.article.issueLabel+' · '+g.file:g.file)+(r.pages.length?' · '+r.pages.join(' · '):' · Markdown 第 '+r.line+' 行');
  const start=Math.max(0,Math.min(r.start,r.text.length));const end=Math.max(start,Math.min(r.end,r.text.length));
  renderReader(r,start,end);
  $('readerPosition').textContent=r.cached?'上次索引片段，无法跳到当前全文':(g.article?(fullIssue?'整期原文 · ':'文章原文 · '):'全文 · ')+'第 '+(r.absoluteStart+1)+' / '+r.total+' 字符';
  $('previousText').hidden=r.cached||r.windowStart<=(r.viewStart||0);$('nextText').hidden=r.cached||r.windowStart+r.text.length>=(r.viewEnd??r.total);$('copyButton').disabled=false;
  renderHitNavigation();$('reader').scrollTop=0;if(offset===undefined)requestAnimationFrame(()=>{if(request===readTicket)scrollToHit();});
 }catch(e){if(request===readTicket){$('reader').textContent=e.message;reading=null;renderHitNavigation();}}
}
function jumpToHit(index){
 if(!selected||!reading?.navigation||selected.groupIndex<0)return;
 if(!Number.isInteger(index)||index<0||index>=reading.navigation.total){toast('请输入有效的命中序号');return;}
 void read(selected.groupIndex,selected.matchIndex,undefined,index,selected);
}
async function search(){
 const query=$('query').value.trim();if(!query){$('query').focus();return;}const ticket=++searchTicket;readTicket++;activeQuery=query;selected=null;reading=null;$('browseIssue').hidden=true;$('hitNavigation').hidden=true;$('hitOverview').hidden=true;$('copyButton').disabled=true;$('reader').textContent='选择结果阅读原文。';$('readerTitle').textContent='原文阅读';$('readerAuthor').textContent='';$('readerMeta').textContent='';$('readerWarning').textContent='';$('previousText').hidden=true;$('nextText').hidden=true;$('searchButton').textContent='检索中';$('resultInfo').textContent='正在检索';notice([]);const id=$('scope').value;const limit=Number($('resultLimit').value);const articlePreview=$('articlePreview').checked;fullIssue=false;
 try{
  const quick=await api('/api/search',{query,id,limit,keywordOnly:true,articlePreview});if(ticket!==searchTicket)return;hits=quick.results;renderResults();notice(quick.warnings);$('resultInfo').textContent=hits.length+' 篇 · 最多'+limit+'篇';if(hits.length&&!selected)void read(0,0,undefined,0);
  if(state.settings.mode==='cloud'){
   $('resultInfo').textContent=hits.length+' 篇 · 补充相关结果中';const full=await api('/api/search',{query,id,limit,articlePreview});if(ticket!==searchTicket)return;hits=full.results;if(selected){const position=hits.findIndex(g=>g.libraryId===selected.libraryId&&g.file===selected.file);if(position>=0)selected.groupIndex=position;else selected.groupIndex=-1;}renderResults();notice(full.warnings);$('resultInfo').textContent=hits.length+' 篇 · '+(full.mode==='hybrid'?'关键词＋语义':'关键词')+(articlePreview?' · 试分':'');if(hits.length&&!selected)void read(0,0,undefined,0);
  }else $('resultInfo').textContent=hits.length+' 篇 · 最多'+limit+'篇';
 }catch(e){if(ticket===searchTicket)notice([e.message]);}
 finally{if(ticket===searchTicket)$('searchButton').textContent='检索';}
}
$('addFolder').onclick=()=>void pick('folder');$('emptyAdd').onclick=()=>void pick('folder');$('addFiles').onclick=()=>void pick('files');$('settingsButton').onclick=openSettings;
$('manageButton').onclick=()=>{renderLibraries();$('manageDialog').showModal();};$('searchButton').onclick=search;$('query').onkeydown=e=>{if(e.key==='Enter')void search();};$('scope').onchange=()=>{renderState();searchTicket++;readTicket++;$('hitNavigation').hidden=true;$('hitOverview').hidden=true;$('searchButton').textContent='检索';hits=[];selected=null;reading=null;renderResults();$('reader').textContent='输入检索内容后，选择结果阅读原文。';$('copyButton').disabled=true;if($('query').value.trim())void search();};
$('results').onclick=e=>{const match=e.target.closest('[data-match]');const card=e.target.closest('[data-hit]');if(card){fullIssue=false;void read(Number(card.dataset.hit),match?Number(match.dataset.match):0,undefined,match?undefined:0);}};$('results').onkeydown=e=>{if(e.key==='Enter'&&e.target.dataset.hit!==undefined){fullIssue=false;void read(Number(e.target.dataset.hit),0,undefined,0);}};
$('copyButton').onclick=async()=>{
 if(!selected||!reading)return;
 const reference='标题：'+(selected.article?.title||(documentInfo(selected).author?documentInfo(selected).title:(reading.heading||documentInfo(selected).title)))+(documentInfo(selected).author?'\n作者：'+documentInfo(selected).author:'')+'\n资料集：'+selected.library+'\n文件：'+selected.file+(selected.article?'\n文章：'+selected.article.title+'\n刊期：'+selected.article.issueLabel+'\n文章边界与类型待核对':'')+(reading.heading?'\n章节：'+reading.heading:'')+'\n'+(reading.pages.length?reading.pages.join(' · '):'Markdown 第 '+reading.line+' 行')+(reading.cached?'\n（旧索引片段，需回查原文）':'');
 try{await navigator.clipboard.writeText(cleanDisplay(reading.copyText??selected.match.text)+'\n\n出处：'+reference);toast('已复制正文与出处');$('copyButton').textContent='✓ 已复制';setTimeout(()=>{$('copyButton').textContent='复制段落与出处';},1800);}catch{toast('复制未成功，请直接选中原文复制。');}
};
$('previousText').onclick=()=>{if(selected&&reading&&selected.groupIndex>=0)void read(selected.groupIndex,selected.matchIndex,Math.max(0,reading.windowStart-10000),reading.navigation?.index,selected);};
$('nextText').onclick=()=>{if(selected&&reading&&selected.groupIndex>=0)void read(selected.groupIndex,selected.matchIndex,reading.windowStart+reading.text.length,reading.navigation?.index,selected);};
$('previousHit').onclick=()=>jumpToHit(reading.navigation.index-1);$('nextHit').onclick=()=>jumpToHit(reading.navigation.index+1);
$('goHit').onclick=()=>jumpToHit(Number($('hitNumber').value)-1);$('hitNumber').onkeydown=e=>{if(e.key==='Enter')jumpToHit(Number($('hitNumber').value)-1);};
$('locateHit').onclick=()=>{if(selected&&reading?.navigation)void read(selected.groupIndex,selected.matchIndex,undefined,reading.navigation.index,selected);};

function renderReader(r,start,end){
 const flags=new Uint8Array(r.text.length);const fill=(a,b,v)=>flags.fill(v,Math.max(0,a),Math.min(flags.length,b));
 for(const x of r.highlights||[])fill(x.start,x.end,1);if(end>start)fill(start,end,2);
 const hidden=r.hiddenRanges||[...r.text.matchAll(pageMarkerPattern())].map(m=>({start:m.index,end:m.index+m[0].length}));
 for(const x of hidden)fill(x.start,x.end,3);
 let html='';for(let a=0;a<flags.length;){const value=flags[a];let b=a+1;while(b<flags.length&&flags[b]===value)b++;if(value!==3){const text=esc(r.text.slice(a,b));html+=value?'<mark class="'+(value===2?'active-hit':'other-hit')+'">'+text+'</mark>':text;}a=b;}
 $('reader').innerHTML=html;
}
function renderOverview(){
 const n=reading.navigation,lo=selected?.article?.start??0,hi=selected?.article?.end??reading.total;const ratio=at=>Math.max(0,Math.min(1,(at-lo)/Math.max(1,hi-lo)));
 $('hitSlider').value=Math.round(ratio(n.start)*1000);$('hitSlider').setAttribute('aria-valuetext','第 '+(n.index+1)+' / '+n.total+' 处');
 const canvas=$('hitMap'),width=Math.max(200,canvas.clientWidth);canvas.width=width*devicePixelRatio;canvas.height=20*devicePixelRatio;const c=canvas.getContext('2d');c.scale(devicePixelRatio,devicePixelRatio);c.fillStyle='#e4eaf0';c.fillRect(0,8,width,4);c.fillStyle='#5792d0';
 for(const m of n.markers||[])c.fillRect(ratio(m.start)*(width-3),5,3,10);c.fillStyle='#24765b';c.fillRect(ratio(n.start)*(width-5),2,5,16);
 $('hitList').innerHTML=(n.items||[]).map(x=>'<button class="hit-item'+(x.index===n.index?' current':'')+'" data-location="'+x.index+'"><b>'+(x.index+1)+'</b><span>'+esc(cleanDisplay(x.excerpt))+'</span></button>').join('');
 const from=n.listStart||0;$('listInfo').textContent=(from+1)+'–'+Math.min(from+(n.items?.length||0),n.total)+' / '+n.total;
 $('listPrevious').disabled=from===0;$('listNext').disabled=from+(n.items?.length||0)>=n.total;
 $('issueView').textContent=fullIssue?'只看文章':'查看整期';
}
function jumpByPosition(value){
 if(!reading?.navigation)return;const a=selected?.article?.start??0,b=selected?.article?.end??reading.total,at=a+Number(value)/1000*(b-a);const markers=reading.navigation.markers||[];
 const nearest=markers.reduce((best,m)=>!best||Math.abs(m.start-at)<Math.abs(best.start-at)?m:best,null);if(nearest)jumpToHit(nearest.index);
}
$('hitSlider').onchange=()=>jumpByPosition($('hitSlider').value);
$('hitMap').onclick=e=>jumpByPosition((e.clientX-e.currentTarget.getBoundingClientRect().left)/e.currentTarget.clientWidth*1000);
$('hitList').onclick=e=>{const b=e.target.closest('[data-location]');if(b){$('hitDetails').open=false;jumpToHit(Number(b.dataset.location));}};
$('listPrevious').onclick=()=>jumpToHit(Math.max(0,(reading.navigation.listStart||0)-30));
$('listNext').onclick=()=>jumpToHit(Math.min(reading.navigation.total-1,(reading.navigation.listStart||0)+30));
$('firstHit').onclick=()=>jumpToHit(0);
$('bestHit').onclick=()=>{if(selected){const g=hits.find(x=>x.libraryId===selected.libraryId&&x.file===selected.file&&x.article?.id===selected.article?.id)||selected;const m=g.matches[0];void read(selected.groupIndex,0,undefined,undefined,{...g,match:m});}};
$('browseIssue').onclick=()=>{if(selected&&reading){fullIssue=!fullIssue;void read(selected.groupIndex,selected.matchIndex,undefined,reading.navigation?.index,selected);}};
$('issueView').onclick=()=>{if(selected&&reading){fullIssue=!fullIssue;void read(selected.groupIndex,selected.matchIndex,undefined,reading.navigation?.index,selected);}};
$('articlePreview').onchange=()=>{if($('query').value.trim())void search();};
function renderCatalog(){
 if(!catalog)return;const type=$('pilotType').value;
 $('pilotCatalog').innerHTML=catalog.files.map((f,i)=>'<details '+(i===0?'open ':'')+'class="catalog-issue"><summary>'+esc(f.issueLabel)+' · '+f.articles.length+' 条内容</summary>'+f.articles.map((a,j)=>type!=='all'&&a.type!==type?'':'<button class="catalog-item" data-catalog-file="'+i+'" data-catalog-article="'+j+'" '+(!f.available?'disabled':'')+'><span class="type-tag">'+esc(a.type)+'</span><b>'+esc(a.title)+'</b><small>'+esc(a.author?'署名线索：'+a.author:'作者未识别')+' · '+(a.pdfPages.length?'PDF '+a.pdfPages[0]+'–'+a.pdfPages.at(-1)+' 页':'页码未记录')+' · 待核对</small></button>').join('')+'</details>').join('');
}
$('pilotType').onchange=renderCatalog;
$('pilotButton').onclick=async()=>{try{catalog=await api('/api/articles');const types=[...new Set(catalog.files.flatMap(f=>f.articles.map(a=>a.type)))];$('pilotType').innerHTML='<option value="all">全部类型</option>'+types.map(t=>'<option>'+esc(t)+'</option>').join('');renderCatalog();$('pilotDialog').showModal();}catch(e){toast(e.message);}};
$('pilotCatalog').onclick=async e=>{
 const b=e.target.closest('[data-catalog-file]');if(!b)return;const f=catalog.files[Number(b.dataset.catalogFile)],a=f.articles[Number(b.dataset.catalogArticle)];
 try{const r=await api('/api/article-read',{id:f.libraryId,file:f.file,articleId:a.id});const g={libraryId:f.libraryId,library:f.library,file:f.file,title:a.title,article:a,available:true,otherSources:[],matches:[{id:r.chunk,text:r.reading.text,start:a.start,end:a.end,pages:r.reading.pages,line:a.line}]};
 searchTicket++;activeQuery='';$('query').value='';hits=[g];fullIssue=false;$('articlePreview').checked=true;$('scope').value=f.libraryId;renderState();$('resultInfo').textContent='文章边界预览 · 待核对';$('pilotDialog').close();await read(0);
 }catch(e){toast(e.message);}
};

$('resultLimit').onchange=()=>{try{localStorage.setItem('rag.resultLimit',$('resultLimit').value);}catch{}if($('query').value.trim())void search();};
try{const limit=localStorage.getItem('rag.resultLimit');if(['20','50','100'].includes(limit))$('resultLimit').value=limit;}catch{}
$('jobs').onclick=e=>{const b=e.target.closest('[data-job]');if(b)void action(b.dataset.job,b.dataset.action);};$('libraryList').onclick=e=>{const b=e.target.closest('[data-library]');if(b)void action(b.dataset.library,b.dataset.action);};
$('settingsForm').onsubmit=async e=>{e.preventDefault();$('saveSettings').disabled=true;$('saveSettings').textContent='正在测试…';$('settingsError').textContent='';try{state=await api('/api/settings',{baseUrl:$('baseUrl').value,model:$('model').value,apiKey:$('apiKey').value});$('settingsDialog').close();renderState();toast('连接正常，已自动匹配模型；已有资料可点击更新。');}catch(err){$('settingsError').textContent=err.message;}finally{$('saveSettings').disabled=false;$('saveSettings').textContent='测试并保存';}};
$('keywordOnly').onclick=async()=>{try{state=await api('/api/settings',{mode:'keyword'});$('settingsDialog').close();renderState();toast('可以先使用关键词检索');}catch(e){$('settingsError').textContent=e.message;}};
$('applySlice').onclick=async()=>{try{await api('/api/update',{id:sliceId,preset:slicePreset});$('sliceDialog').close();await refresh();toast('已开始按新方式处理，完成后自动切换。');}catch(e){toast(e.message);}};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());document.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>void previewSlice(b.dataset.preset));
(async()=>{await refresh();try{const p=await api('/api/articles');const available=p.files.length>0;$('pilotButton').hidden=!available;$('articlePreview').closest('label').hidden=!available;}catch{}if(!state.settings.initialized)openSettings();})();setInterval(refresh,2000);

let relocatingPath=null;
function openPath(id=null){relocatingPath=id;$('folderPath').value='';$('pathError').textContent='';if($('manageDialog').open)$('manageDialog').close();if($('settingsDialog').open)$('settingsDialog').close();$('pathDialog').showModal();}
$('manualPathButton').onclick=()=>openPath();
$('addPathButton').onclick=async()=>{const path=$('folderPath').value.trim();if(!path)return;$('addPathButton').disabled=true;try{const r=await api(relocatingPath?'/api/relocate':'/api/libraries',relocatingPath?{id:relocatingPath,path}:{kind:'folder',path});$('pathDialog').close();await refresh();const id=r.added?.[0]?.id||relocatingPath;if(id){$('scope').value=id;renderState();}toast('资料文件夹已添加');}catch(e){$('pathError').textContent=e.message;}finally{$('addPathButton').disabled=false;}};

$('manualInitial').onclick=async()=>{if(!state.settings.initialized){state=await api('/api/settings',{mode:'keyword'});renderState();}openPath();};

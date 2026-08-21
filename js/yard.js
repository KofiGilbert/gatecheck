/* Checkpoint · https://gatecheck-martinbrower.netlify.app */

/* =================== YARD CHECK (F-US399-QS-36 Trailer Inspection Log) =================== */
DB.yardchecks = [];
try{ var _yc0 = sget('gc_ycs'); if(_yc0) DB.yardchecks = JSON.parse(_yc0); }catch(e){}
function ycPersistAll(){ try{ sset('gc_ycs', JSON.stringify(DB.yardchecks.slice(0,40))); }catch(e){} }

var YC_SLOTS = ['0000','0200','0400','0600','0800','1000','1200','1400','1600','1800','2000','2200'];
var YC_FUELS = ['FULL','3/4','1/2','1/4','E'];
var YC = null;

function ycBlank(){
  var d = new Date();
  var slot = YC_SLOTS[Math.floor(d.getHours()/2) % 12];
  return { date: d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'),
    time: slot, name: getOfficerName(), rows: [] };
}
function ycRowBlank(){ return {trailer:'',product:'',set:'',temp:'',type:'',fuel:'',intact:'',door:'',action:''}; }
function ycSaveDraft(){ try{ sset('gc_ycdraft', JSON.stringify(YC)); }catch(e){} }
function ycLoadDraft(){
  try{ var d=sget('gc_ycdraft'); if(d){ YC=JSON.parse(d); return; } }catch(e){}
  YC = ycBlank();
}

/* ---------- rules ---------- */
function ycIsTenth(v){ return /^-?\d+\.\d$/.test(String(v).trim()); }
function ycIsNumLoose(v){ return /^-?\d+(\.\d)?$/.test(String(v).trim()); }
function ycAutoType(row){
  if(String(row.set).toUpperCase()==='DEF') return row.type||'';
  if(ycIsNumLoose(row.set)){ return parseFloat(row.set) <= 0 ? 'FROZEN' : 'COOLER'; }
  return row.type||'';
}
function ycEval(row){
  var reasons = [];
  var setDef = String(row.set).trim().toUpperCase()==='DEF';
  var tmpDef = String(row.temp).trim().toUpperCase()==='DEF';
  if(setDef || tmpDef) reasons.push('DEF (DEFROST) SHOWING');
  if(!tmpDef && ycIsTenth(row.temp)){
    var t = parseFloat(row.temp);
    var type = row.type || ycAutoType(row);
    if(type==='FROZEN' && t >= 0.05) reasons.push('TEMP OUT OF RANGE: frozen must be 0.0° or less');
    if(type==='COOLER' && (t < 33.95 || t > 40.05)) reasons.push('TEMP OUT OF RANGE: cooler must be 34.0° to 40.0°');
  }
  if(row.fuel==='1/4' || row.fuel==='E') reasons.push('LOW FUEL: ¼ tank or less');
  return reasons;
}

/* ---------- slot board ----------
   One tile per two-hour check. Status words, highest priority first:
   Completed · Due now · Up next · Ready · Awaiting list · Missed.
   "Ready" means the receiving office has loaded the trailer block for that slot.
   It is informational only: an officer is never blocked from starting a check,
   because a missed safety check is worse than an unloaded list. */
DB.yardslots = [];
try{ var _ys0 = sget('gc_yardslots'); if(_ys0) DB.yardslots = JSON.parse(_ys0); }catch(e){}
function ycSlotsPersist(){ try{ sset('gc_yardslots', JSON.stringify(DB.yardslots.slice(0,200))); }catch(e){} }
function ycTodayISO(){
  var d=new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
var YC_LEGEND = [
  ['done','Completed'], ['esc','Escalations'], ['ready','Ready to start'],
  ['over','Overdue'], ['due','Due this hour'], ['next','Up next'],
  ['wait','Awaiting list'], ['past','Not recorded']
];
var YC_WINDOW_MIN = 60;   /* one hour to complete, from the moment the office loads it */
function ycSlotRecord(slot){
  var t=ycSlotDate(slot);
  return (DB.yardslots||[]).filter(function(r){ return r && r.date===t && r.slot===slot && r.loadedAt; })[0] || null;
}
function ycSlotLoaded(slot){ return !!ycSlotRecord(slot); }
function ycSlotCheck(slot){
  var t=ycSlotDate(slot);
  return (DB.yardchecks||[]).filter(function(c){ return c && c.date===t && c.time===slot; })[0] || null;
}
function ycSlotDone(slot){ return !!ycSlotCheck(slot); }
function ycMinsLeft(rec){
  if(!rec || !rec.loadedAt) return null;
  var ms = new Date(rec.loadedAt).getTime() + YC_WINDOW_MIN*60000 - Date.now();
  return Math.ceil(ms/60000);
}
function ycHHMM(iso){
  try{ var d=new Date(iso);
    return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }
  catch(e){ return ''; }
}
function ycSlotTrailers(rec){
  if(!rec) return 0;
  if(typeof rec.count==='number') return rec.count;
  return (rec.trailers && rec.trailers.length) || 0;
}
function ycCheckEscalations(chk){
  if(!chk || !chk.rows) return 0;
  return chk.rows.filter(function(r){ return r && (r.escalate||[]).length; }).length;
}
function ycCurrentSlotIndex(){ return Math.floor(new Date().getHours()/2) % 12; }
/* An officer only ever sees their own shift: six checks, in the order they fall.
   Morning runs 06:00-18:00, evening 18:00-06:00 and crosses midnight. */
var YC_SHIFT_AM = ['0600','0800','1000','1200','1400','1600'];
var YC_SHIFT_PM = ['1800','2000','2200','0000','0200','0400'];
function ycIsMorning(d){ var h=(d||new Date()).getHours(); return h>=6 && h<18; }
function ycShiftSlots(d){ return ycIsMorning(d)? YC_SHIFT_AM.slice() : YC_SHIFT_PM.slice(); }
function ycShiftLabel(d){ return ycIsMorning(d)? 'Morning shift' : 'Evening shift'; }
function _ycISO(d){
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
/* On the evening shift 00/02/04 belong to tomorrow; after midnight 18/20/22
   belonged to yesterday. Everything keys off the slot's real calendar date. */
function ycSlotDate(slot){
  var now=new Date(), h=now.getHours(), i=YC_SLOTS.indexOf(slot), d=new Date(now);
  if(h>=18 && i<=2)      d.setDate(d.getDate()+1);
  else if(h<6 && i>=9)   d.setDate(d.getDate()-1);
  return _ycISO(d);
}
function ycSlotEnd(slot){
  var p=ycSlotDate(slot).split('-'), i=YC_SLOTS.indexOf(slot);
  return new Date(+p[0], +p[1]-1, +p[2], i*2+2, 0, 0, 0);
}
function ycNowHour(){ return new Date().getHours(); }
function ycSlotWindowClosed(slot){ return Date.now() >= ycSlotEnd(slot).getTime(); }
/* Card shape follows the reference: status word on top, the check time large in
   the centre, and a KPI with a direction arrow in the darker band below.
   Where a card has no honest KPI it shows a dash rather than an invented number. */
function ycSlotStatus(slot){
  var done = ycSlotCheck(slot);
  if(done){
    var who = (done.name||'').split(' ')[0];
    var esc = ycCheckEscalations(done);
    var n   = (done.rows||[]).length;
    var rate = n? Math.round(esc/n*100) : 0;
    return { cls: esc? 'esc':'done', top:'Completed',
             arrow: esc? '\u2197':'\u2198', kpi: rate+'%',
             kpiLabel:'escalation rate',
             detail: ycHHMM(done.ts)+(who?' \u00b7 '+who:'')
                   + (n? ' \u00b7 '+n+' trailers':'')
                   + (esc? ' \u00b7 '+esc+' escalated':' \u00b7 all clear') };
  }
  var rec = ycSlotRecord(slot);
  var sh = ycShiftSlots(), si = sh.indexOf(slot);
  var cur = -1;
  for(var k=0;k<sh.length;k++){ if(!ycSlotWindowClosed(sh[k])){ cur=k; break; } }
  if(rec){
    var t = ycSlotTrailers(rec), tl = t? (t+' trailers'):'';
    var left = ycMinsLeft(rec);
    if(left > 0){
      var pct = Math.round(left/YC_WINDOW_MIN*100);
      return { cls:'ready', top:'Ready to start', arrow:'\u2198', kpi:pct+'%',
               kpiLabel:'of the hour left', mins:left,
               bar: Math.max(0, Math.min(1, left/YC_WINDOW_MIN)),
               detail: (tl? tl+' \u00b7 ':'')+left+' min left' };
    }
    var over = Math.round((-left)/YC_WINDOW_MIN*100);
    return { cls:'over', top:'Overdue', arrow:'\u2197', kpi:over+'%',
             kpiLabel:'past the hour', detail:(tl? tl+' \u00b7 ':'')+'still to be completed' };
  }
  if(ycSlotWindowClosed(slot))
    return { cls:'past', top:'Not recorded', arrow:'\u2014', kpi:'\u2014',
             kpiLabel:'no check on file', detail:'no check on file' };
  if(si===cur)
    return { cls:'due',  top:'Due this hour', arrow:'\u2014', kpi:'\u2014',
             kpiLabel:'awaiting the list', detail:'awaiting the list' };
  if(si===cur+1)
    return { cls:'next', top:'Up next', arrow:'\u2014', kpi:'\u2014',
             kpiLabel:'awaiting the list', detail:'awaiting the list' };
  return { cls:'wait', top:'Awaiting list', arrow:'\u2014', kpi:'\u2014',
           kpiLabel:'not loaded yet', detail:'not loaded yet' };
}
function ycActionable(){
  return ycShiftSlots().filter(function(s){
    var st=ycSlotStatus(s); return st.cls==='ready' || st.cls==='over';
  }).length;
}
function renderYardSlots(){
  var d=$('ycslotdate'); if(d) d.textContent = ycShiftLabel();
  var host=$('ycslots'); if(!host) return;
  host.innerHTML = ycShiftSlots().map(function(slot){
    var st = ycSlotStatus(slot);
    var hh = slot.slice(0,2);
    var aria = hh+':00 \u2014 '+st.top+', '+st.detail;
    return '<button class="slot '+st.cls+'" aria-label="'+esc(aria)+'"'
      + ' title="'+esc(hh+':00 \u2014 '+st.detail)+'"'
      + ' onclick="ycOpenSlot(\''+slot+'\')">'
      + '<span class="top">'+esc(st.top)+'</span>'
      + '<span class="hero"><b>'+hh+'</b></span>'
      + (st.bar!=null? '<span class="bar" style="--p:'+st.bar.toFixed(3)+'"><s></s></span>':'')
      + '<span class="band"><span class="arw" aria-hidden="true">'+st.arrow+'</span>'
      +   '<span class="kpi">'+st.kpi+'</span></span>'
      + '</button>';
  }).join('');
  var lg=$('yclegend');
  if(lg) lg.innerHTML = YC_LEGEND.map(function(k){
    return '<span class="lg '+k[0]+'"><i></i>'+esc(k[1])+'</span>';
  }).join('');
  ycUpdateBadge();
}

/* ---------- "it is available to start" notification ---------- */
function ycSeenReady(){ try{ return JSON.parse(sget('gc_ycseen')||'[]'); }catch(e){ return []; } }
function ycNotifyReady(){
  var seen=ycSeenReady(), fresh=[];
  ycShiftSlots().forEach(function(slot){
    var rec=ycSlotRecord(slot); if(!rec) return;
    if(ycSlotDone(slot)) return;
    var key=ycSlotDate(slot)+'_'+slot;
    if(seen.indexOf(key)<0){ fresh.push(slot); seen.push(key); }
  });
  if(fresh.length){
    try{ sset('gc_ycseen', JSON.stringify(seen.slice(-60))); }catch(e){}
    var n=fresh.length;
    toast(n===1
      ? 'Yard check '+fresh[0].slice(0,2)+' is ready to start. One hour to complete it.'
      : n+' yard checks are ready to start.');
  }
  ycUpdateBadge();
}
function ycUpdateBadge(){
  var b=$('yardbadge'); if(!b) return;
  var n=ycActionable();
  b.textContent = n? String(n) : '';
  b.hidden = !n;
}
/* the countdown has to keep moving while the officer is looking at the board */
var _ycTick=null;
function ycStartTicking(){
  ycStopTicking();
  _ycTick=setInterval(function(){
    var sec=$('sec-yard');
    if(sec && sec.classList.contains('on')) renderYardSlots(); else ycUpdateBadge();
  }, 30000);
}
function ycStopTicking(){ if(_ycTick){ clearInterval(_ycTick); _ycTick=null; } }

var YC_VIEW = null, _ycDraftStash = null;
/* A completed slot opens the check that was saved, read only. The officer's
   own unfinished draft is put aside and restored on the way out. */
function ycOpenSlot(slot){
  if(!YC) ycLoadDraft();
  var saved = ycSlotCheck(slot);
  if(saved){
    if(!YC_VIEW) _ycDraftStash = JSON.parse(JSON.stringify(YC));
    YC_VIEW = slot;
    YC = { date: saved.date, time: saved.time, name: saved.name||'',
           _ts: saved.ts, _saved: saved,
           rows: (saved.rows||[]).map(function(r){
             return { trailer:r.trailer||'', product:r.product||'', set:r.set||'',
                      temp:r.temp||'', type:r.type||'', fuel:r.fuel||'',
                      intact:r.intact||'', door:r.door||'', action:r.action||'' };
           }) };
  } else {
    ycExitView();
    var prevTime = YC.time;
    /* the slot fixes the date and time; the signed-in officer fixes the name */
    YC.time = slot;
    YC.date = ycSlotDate(slot);
    YC.name = getOfficerName();
    /* the office released the trailers for this check, so start from those.
       Only when moving to a different check, or when nothing has been typed:
       work already in progress is never overwritten. */
    var rec = ycSlotRecord(slot);
    if(rec && rec.trailers && rec.trailers.length && (prevTime !== slot || !YC.rows.length)){
      YC.rows = rec.trailers.map(function(t){
        return { trailer:(t.trailer||'').toUpperCase(), product:(t.product||'').toUpperCase(),
                 set:'', temp:'', type:'', fuel:'', intact:'', door:'', action:'' };
      });
    }
    ycSaveDraft();
  }
  go('yardsheet');
}
function ycExitView(){
  if(!YC_VIEW) return;
  YC_VIEW = null;
  if(_ycDraftStash){ YC = _ycDraftStash; _ycDraftStash = null; }
  else ycLoadDraft();
}
function ycApplyViewMode(){
  var sec=$('sec-yardsheet'); if(!sec) return;
  var on = !!YC_VIEW;
  sec.classList.toggle('viewing', on);
  var b=$('ycviewbar');
  if(b){
    b.hidden = !on;
    if(on){
      var who=(YC.name||'').trim();
      b.textContent = 'Saved yard check \u00b7 completed '+ycHHMM(YC._ts)
        + (who? ' by '+who : '') + '. This record cannot be changed.';
    }
  }
}
/* ---------- UI (grid layout matching the printed log) ---------- */
var YC_MIN_ROWS = 18;
function renderYard(){
  if(!YC) ycLoadDraft();
  renderYardSlots();
  /* these are fixed by the slot you opened and by who is signed in */
  $('yc_date').textContent = ycFmtDate(YC.date);
  $('yc_time').textContent = YC.time;
  $('yc_name').textContent = YC.name || getOfficerName();
  /* column headings exactly as printed on the sheet */
  var head = '<tr>'
    + '<th style="min-width:92px">TRAILER#</th>'
    + '<th style="min-width:104px">PRODUCT</th>'
    + '<th style="min-width:104px">TEMP SET POINT</th>'
    + '<th style="min-width:82px">TEMP</th>'
    + '<th style="min-width:76px">FUEL</th>'
    + '<th style="min-width:74px">INTACT<br>(Y or N)</th>'
    + '<th style="min-width:70px">DOOR #</th>'
    + '<th style="min-width:230px">*ESCALATE*<br>ACTION (if any was taken)</th>'
    + '<th style="min-width:34px"></th></tr>';
  var body = YC.rows.map(function(r,i){ return ycRowHTML(r,i); }).join('');
  var blanks = YC_VIEW? 0 : Math.max(0, YC_MIN_ROWS - YC.rows.length);
  for(var b=0;b<blanks;b++){
    body += '<tr>'+new Array(10).join('<td class="ycblank">&nbsp;</td>')+'</tr>';
  }
  $('ycrows').innerHTML = '<div class="ycwrap"><table class="yct ycsheet">'+head+body+'</table></div>';
  YC.rows.forEach(function(r,i){ ycBanner(i); });
  ycSummary();
  ycApplyViewMode();
}
function ycSelHTML(i,k,list,cur){
  return '<select onchange="ycSet('+i+',\''+k+'\',this.value,true)"><option value=""></option>'
    + list.map(function(v){ return '<option '+(cur===v?'selected':'')+'>'+v+'</option>'; }).join('')+'</select>';
}
function ycCell(v){ return '<td class="ycro">'+esc(v||'')+'</td>'; }
function ycRowHTML(r,i){
  if(YC_VIEW){
    return '<tr id="ycr'+i+'">'
      + ycCell(String(r.trailer||'').toUpperCase()) + ycCell(String(r.product||'').toUpperCase())
      + ycCell(r.set) + ycCell(r.temp) + ycCell(r.fuel) + ycCell(r.intact) + ycCell(r.door)
      + '<td id="ycb'+i+'"></td><td></td></tr>';
  }
  return '<tr id="ycr'+i+'">'
    +'<td><input style="font-weight:800;text-transform:uppercase" placeholder="LR7524" value="'+esc(r.trailer)+'" oninput="ycSet('+i+',\'trailer\',this.value,true)"></td>'
    +'<td><input style="text-transform:uppercase" placeholder="FRIES" value="'+esc(r.product)+'" oninput="ycSet('+i+',\'product\',this.value,true)"></td>'
    +'<td><input placeholder="-10.0 / DEF" value="'+esc(r.set)+'" oninput="ycSet('+i+',\'set\',this.value,true)" onblur="ycBlurSet('+i+',this)"></td>'
    +'<td><input placeholder="-9.9 / DEF" value="'+esc(r.temp)+'" oninput="ycSet('+i+',\'temp\',this.value,true)" onblur="ycBlurTemp('+i+',this)"></td>'
    +'<td>'+ycSelHTML(i,'fuel',YC_FUELS,r.fuel)+'</td>'
    +'<td>'+ycSelHTML(i,'intact',['Y','N'],r.intact)+'</td>'
    +'<td><input placeholder="N/A" value="'+esc(r.door)+'" oninput="ycSet('+i+',\'door\',this.value,true)"></td>'
    +'<td id="ycb'+i+'"></td>'
    +'<td><button class="delx" onclick="ycDel('+i+')">\u2715</button></td>'
    +'</tr>';
}
function ycBanner(i){
  var r = YC.rows[i], el = $('ycb'+i), tr = $('ycr'+i); if(!el) return;
  var reasons = ycEval(r);
  if(tr) tr.classList.toggle('esc', reasons.length>0);
  if(reasons.length){
    el.innerHTML = '<div class="escmsg">🚨 *ESCALATE*: '+reasons.map(esc).join(' · ')+'</div>'
      + (YC_VIEW
          ? '<div class="ycro" style="padding:2px 8px 7px;white-space:normal">'+esc(r.action||'\u2014')+'</div>'
          : '<input style="font-size:13.5px" placeholder="Action taken…" value="'+esc(r.action)+'" oninput="ycSet('+i+',\'action\',this.value,true)">');
  } else if(r.temp && (ycIsTenth(r.temp) || String(r.temp).toUpperCase()==='DEF')){
    el.innerHTML = '<div class="okmsg">N/A · in range ✓</div>';
  } else el.innerHTML = '';
}
function ycSet(i,k,v,noRender){
  var r = YC.rows[i]; if(!r) return;
  if(k==='type'){ r[k] = (r[k]===v? '' : v); }
  else r[k] = v;
  if(k==='set'){ var at=ycAutoType(r); if(at) r.type=at; }
  ycSaveDraft();
  if(noRender){
    if(k==='set'){ var tEl=$('yctype'+i); if(tEl) tEl.querySelectorAll('button').forEach(function(b){ b.classList.toggle('sel', b.textContent===r.type); }); }
    ycBanner(i); ycSummary();
  } else renderYard();
  if(window.invalidateYcPreview) invalidateYcPreview();
}
function ycDef(i,k){ YC.rows[i][k]='DEF'; ycSaveDraft(); renderYard(); }
function ycBlurTemp(i,el){
  var v = el.value.trim();
  if(v.toUpperCase()==='DEF' && v!=='DEF'){ el.value='DEF'; ycSet(i,'temp','DEF',true); return; }
  if(!v || v==='DEF') return;
  if(!ycIsTenth(v)){
    toast('Temp must be recorded to the tenth, e.g. '+(ycIsNumLoose(v)? v+'.0 (if that is the true reading)':'-10.0'));
    el.style.borderColor = '#E74C3C';
  } else el.style.borderColor = '';
}
function ycBlurSet(i,el){
  var v = el.value.trim();
  if(v.toUpperCase()==='DEF' && v!=='DEF'){ el.value='DEF'; ycSet(i,'set','DEF',true); return; }
  if(!v || v==='DEF') return;
  if(ycIsNumLoose(v) && v.indexOf('.')<0){ el.value = v+'.0'; ycSet(i,'set',el.value,true); }
}
function ycDel(i){ YC.rows.splice(i,1); ycSaveDraft(); renderYard(); }
function ycAdd(){ YC.rows.push(ycRowBlank()); ycSaveDraft(); renderYard();
  setTimeout(function(){ var e=document.querySelector('#ycr'+(YC.rows.length-1)+' input'); if(e) e.focus(); },50); }
function ycCopyLast(){
  var last = DB.yardchecks && DB.yardchecks[0];
  if(!last || !last.rows || !last.rows.length){ toast('No previous yard check to copy from'); return; }
  YC.rows = last.rows.map(function(r){
    return {trailer:r.trailer, product:r.product, set:r.set, temp:'', type:r.type, fuel:'', intact:'', door:'', action:''};
  });
  ycSaveDraft(); renderYard();
  toast('Copied '+YC.rows.length+' trailers from the last check. Enter fresh temps.');
}
function ycNew(){
  if(!confirm('Start a new blank yard check? The current one is discarded unless saved.')) return;
  YC = ycBlank(); ycSaveDraft(); renderYard(); $('ycpreview').innerHTML=''; invalidateYcPreview();
}
function ycSummary(){
  var n = YC.rows.length, esc_n = 0;
  YC.rows.forEach(function(r){ if(ycEval(r).length) esc_n++; });
  $('ycsum').innerHTML = n? ('<b>'+n+'</b> trailer'+(n>1?'s':'')+' · '
    +(esc_n? '<span style="color:var(--red);font-weight:800">'+esc_n+' escalation'+(esc_n>1?'s':'')+'</span>'
           : '<span style="color:var(--green);font-weight:700">no escalations</span>')) : '';
}
function invalidateYcPreview(){ var a=$('ycactions'); if(a) a.style.display='none'; }

/* ---------- validation + preview ---------- */
function ycProblems(){
  var block=[], warn=[];
  if(!YC.rows.length) block.push('No trailers on this check');
  YC.rows.forEach(function(r,i){
    var lbl = r.trailer? r.trailer : 'Row '+(i+1);
    var t = String(r.temp).trim();
    if(t && t.toUpperCase()!=='DEF' && !ycIsTenth(t))
      block.push(lbl+': temp "'+t+'" is not to the tenth (e.g. -10.0)');
    if(!r.trailer) warn.push('Row '+(i+1)+': Trailer # empty');
    if(!t) warn.push(lbl+': Temp empty');
    if(!String(r.set).trim()) warn.push(lbl+': Set Point empty');
    if(!r.fuel) warn.push(lbl+': Fuel empty');
    if(!r.intact) warn.push(lbl+': Intact Y/N empty');
    if(ycEval(r).length && !r.action.trim()) warn.push(lbl+': escalation has no "action taken"');
  });
  return {block:block, warn:warn};
}
function ycPreview(){
  ycSaveDraft();
  var p = ycProblems();
  if(p.block.length){
    alert('Fix these before continuing (temps MUST be to the tenth degree):\n\n• '+p.block.join('\n• '));
    return;
  }
  if(p.warn.length && !confirm('These fields are still empty:\n\n• '+p.warn.join('\n• ')
      +'\n\nOK = continue anyway · Cancel = go back')) return;
  drawYardPaper(ycData(), function(cv){
    $('ycpreview').innerHTML = '<img alt="yard check preview" style="width:100%;border:1px solid var(--line);border-radius:8px" src="'+cv.toDataURL('image/png')+'">';
    $('ycactions').style.display='block';
    toast('Check the log, then save / email below');
  });
}
function ycData(){
  return { kind:'yard', ts:new Date().toISOString(),
    date:YC.date, time:YC.time, name:YC.name||getOfficerName(),
    rows: YC.rows.map(function(r){ var reasons=ycEval(r);
      return {trailer:r.trailer,product:r.product,set:r.set,temp:r.temp,type:r.type,
        fuel:r.fuel,intact:r.intact,door:r.door,action:r.action,escalate:reasons}; }) };
}
function ycFmtDate(iso){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(iso||'')) return iso||'';
  var p=iso.split('-'); return p[1]+'/'+p[2]+'/'+p[0];
}

/* ---------- render the paper log ---------- */
function drawYardPaper(d, done){
  var cv=$('paper'), g=cv.getContext('2d');
  g.setTransform(1,0,0,1,0,0);
  g.fillStyle='#fff'; g.fillRect(0,0,1275,1650);
  function txt(t,x,y,size,bold,italic,center,color){
    g.fillStyle=color||'#111';
    g.font=(italic?'italic ':'')+(bold?'bold ':'')+size+'px Arial';
    g.textAlign=center?'center':'left'; g.fillText(t,x,y); g.textAlign='left'; g.fillStyle='#111';
  }
  txt('F-US399-QS-36 Trailer Inspection Log',637,64,32,true,false,true);
  txt('Air temperature critical limits: Freezer 0° or less / Cooler: 34.0°–40.0°',637,98,22,true,false,true);
  txt('DATE: '+ycFmtDate(d.date),60,145,24,true);
  txt('TIME: 00, 02, 04, 06, 08, 10, 12, 14, 16, 18, 20, 22',60,178,22,true);
  txt('Time: '+d.time,60,211,24,true);
  txt('NAME: '+(d.name||''),60,244,24,true);
  var esc_n = d.rows.filter(function(r){return r.escalate.length;}).length;
  g.textAlign='right';
  g.fillStyle = esc_n? '#C0392B':'#1E7B45';
  g.font='bold 22px Arial';
  g.fillText(d.rows.length+' trailers · '+esc_n+' escalation'+(esc_n===1?'':'s'), 1215, 145);
  g.textAlign='left'; g.fillStyle='#111';
  // table
  var cols = [
    {k:'trailer', t:'TRAILER#', x:60,  w:130},
    {k:'product', t:'PRODUCT', x:190, w:170},
    {k:'set',     t:'TEMP SET POINT', x:360, w:150},
    {k:'temp',    t:'TEMP', x:510, w:110},
    {k:'fuel',    t:'FUEL', x:620, w:90},
    {k:'intact',  t:'INTACT (Y/N)', x:710, w:100},
    {k:'door',    t:'DOOR #', x:810, w:90},
    {k:'act',     t:'*ESCALATE* / ACTION', x:900, w:315}
  ];
  var top=280, headH=44;
  var rowH = Math.max(34, Math.min(58, Math.floor((1560-top-headH)/Math.max(1,d.rows.length))));
  var bottom = top+headH+rowH*d.rows.length;
  g.strokeStyle='#333'; g.lineWidth=1.4;
  // grid
  g.strokeRect(60, top, 1155, headH+rowH*d.rows.length);
  cols.forEach(function(c,ci){ if(ci){ g.beginPath(); g.moveTo(c.x,top); g.lineTo(c.x,bottom); g.stroke(); } });
  for(var r=0;r<=d.rows.length;r++){ var y=top+headH+r*rowH;
    g.beginPath(); g.moveTo(60,y); g.lineTo(1215,y); g.stroke(); }
  cols.forEach(function(c){
    var words=c.t.split(' ');
    if(words.length>2 || c.t.length>12){ txt(words.slice(0,Math.ceil(words.length/2)).join(' '), c.x+c.w/2, top+18, 15, true, false, true);
      txt(words.slice(Math.ceil(words.length/2)).join(' '), c.x+c.w/2, top+36, 15, true, false, true); }
    else txt(c.t, c.x+c.w/2, top+28, 16, true, false, true);
  });
  var fs = rowH>=46? 19 : 16;
  d.rows.forEach(function(r,i){
    var y = top+headH+i*rowH+Math.round(rowH/2)+6;
    var bad = r.escalate.length>0;
    var defS = String(r.set).toUpperCase()==='DEF', defT = String(r.temp).toUpperCase()==='DEF';
    txt(String(r.trailer).toUpperCase(), cols[0].x+cols[0].w/2, y, fs, true, false, true);
    txt(String(r.product).toUpperCase(), cols[1].x+cols[1].w/2, y, fs-2, false, false, true);
    txt(String(r.set).toUpperCase(), cols[2].x+cols[2].w/2, y, fs, false, false, true, defS?'#C0392B':'#111');
    txt(String(r.temp).toUpperCase(), cols[3].x+cols[3].w/2, y, fs, true, false, true,
        (bad && (defT || r.escalate.some(function(x){return x.indexOf('TEMP')===0;})))?'#C0392B':'#111');
    txt(r.fuel||'', cols[4].x+cols[4].w/2, y, fs, false, false, true,
        (r.fuel==='1/4'||r.fuel==='E')?'#C0392B':'#111');
    txt(r.intact||'', cols[5].x+cols[5].w/2, y, fs, false, false, true);
    txt(r.door||'N/A', cols[6].x+cols[6].w/2, y, fs, false, false, true);
    if(bad){
      var reason = r.escalate.map(function(x){ return x.split(/ — |: /)[0]; }).join(', ');
      var line1 = '*ESCALATE* '+reason;
      var line2 = r.action? ('Action: '+r.action) : '';
      if(rowH>=44 && line2){
        txt(line1, cols[7].x+6, y-8, 14, true, false, false, '#C0392B');
        txt(line2.slice(0,42), cols[7].x+6, y+10, 13, false, false, false, '#7A1F14');
      } else {
        txt((line1+(line2? ' · '+line2:'')).slice(0,46), cols[7].x+6, y, 13, true, false, false, '#C0392B');
      }
    } else {
      txt('N/A', cols[7].x+cols[7].w/2, y, fs-2, false, false, true, '#666');
    }
  });
  txt('Escalate to the DC if: out of temperature range · fuel ¼ tank or less · DEF showing',637,bottom+40,18,false,true,true,'#555');
  txt('Generated by Checkpoint · '+new Date(d.ts).toLocaleString(),637,1600,18,false,true,true,'#666');
  done(cv);
}
function ycFileName(d){ return 'YardCheck_'+(d.date||'').replace(/-/g,'')+'_'+(d.time||'')+'.png'; }

/* ---------- save / email / share ---------- */
function ycSave(){
  var d = ycData();
  if(window.CLOUD && CLOUD.ready){
    d.createdBy = CLOUD.user.email;
    CLOUD.db.collection('yardchecks').add(d).catch(function(e){ toast('Could not save: '+e.message); });
    toast('Yard check saved ✔. Visible to the whole team.');
  } else {
    DB.yardchecks.unshift(d); if(DB.yardchecks.length>40) DB.yardchecks.length=40;
    ycPersistAll(); renderYardHist();
    toast('Yard check saved ✔ ('+DB.yardchecks.length+' on file)');
  }
}
function ycSendData(d){
  var esc_n = d.rows.filter(function(r){return r.escalate.length;}).length;
  var svc = getMailerUrl();
  drawYardPaper(d, function(cv){
    if(svc){
      toast('📤 Sending yard check…');
      var png=cv.toDataURL('image/png').split(',')[1];
      fetch(svc, {method:'POST', body: JSON.stringify({
        to:getOfficeEmail(), cc:getCcEmails(),
        png:png, filename:ycFileName(d),
        po:'YARD CHECK '+ycFmtDate(d.date)+' '+d.time,
        carrier:'Trailer Inspection Log', driver:d.name,
        datein:ycFmtDate(d.date), timein:d.time,
        sealcond:(esc_n? esc_n+' ESCALATION'+(esc_n>1?'S':''):'NO ESCALATIONS'),
        sealtype:d.rows.length+' TRAILERS', sealtrailer:'F-US399-QS-36',
        sentBy:(window.CLOUD && CLOUD.user && CLOUD.user.email)||''
      })})
      .then(function(r){ return r.json(); })
      .then(function(j){ toast(j&&j.ok? '✅ Yard check sent to the receiving office'
        : '⚠️ Send failed'+((j&&j.error)?': '+j.error:'')+'. Use Share.'); })
      .catch(function(){ toast('⚠️ Could not confirm the send. Check with the office, or use Share.'); });
    } else {
      cv.toBlob(function(blob){
        var f=new File([blob], ycFileName(d), {type:'image/png'});
        if(navigator.canShare && navigator.canShare({files:[f]}))
          navigator.share({files:[f], title:'Yard Check '+ycFmtDate(d.date)+' '+d.time}).catch(function(){});
        else { var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=ycFileName(d); a.click();
          toast('Image downloaded. Attach it to your email.'); }
      },'image/png');
    }
  });
}
function ycEmail(){ ycSendData(ycData()); }
function ycShare(){
  drawYardPaper(ycData(), function(cv){
    cv.toBlob(function(blob){
      var d=ycData(), f=new File([blob], ycFileName(d), {type:'image/png'});
      if(navigator.canShare && navigator.canShare({files:[f]}))
        navigator.share({files:[f], title:'Yard Check '+ycFmtDate(d.date)+' '+d.time}).catch(function(){});
      else { var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=ycFileName(d); a.click(); }
    },'image/png');
  });
}
function renderYardHist(){
  var el=$('ychist'); if(!el) return;   /* the panel was removed; kept harmless for sync callers */
  if(!DB.yardchecks.length){ el.innerHTML='<div class="empty">No saved yard checks yet.</div>'; return; }
  el.innerHTML = DB.yardchecks.map(function(y,i){
    var esc_n=(y.rows||[]).filter(function(r){return (r.escalate||[]).length;}).length;
    return '<div class="histitem"><div>'
      +'<div class="t1">'+esc(ycFmtDate(y.date))+' · '+esc(y.time)+' · '+esc(y.name||'')+'</div>'
      +'<div class="t2">'+(y.rows||[]).length+' trailers · '
      +(esc_n?'<b style="color:var(--red)">'+esc_n+' escalation'+(esc_n>1?'s':'')+'</b>':'no escalations')
      +(y.createdBy? ' · by '+esc(String(y.createdBy).split('@')[0]):'')+'</div></div>'
      +'<div class="histbtns"><button class="btn" onclick="ycHistSend('+i+')">📧</button>'
      +'<button class="btn red" onclick="ycHistDel('+i+')">✕</button></div></div>';
  }).join('');
}
function ycHistSend(i){ ycSendData(DB.yardchecks[i]); }
function ycHistDel(i){
  var y=DB.yardchecks[i];
  if(!confirm('Delete this saved yard check'+(window.CLOUD&&CLOUD.ready?' for everyone':'')+'?')) return;
  if(window.CLOUD && CLOUD.ready && y._id){ CLOUD.db.collection('yardchecks').doc(y._id).delete(); }
  else { DB.yardchecks.splice(i,1); ycPersistAll(); renderYardHist(); }
}
/* ---------- yard photo import ---------- */
var YC_STOPWORDS = /TRAILER|PRODUCT|DATE:|TIME|NAME|ESCALATE|ACTION|DOOR|INTACT|FUEL|TEMP|SET POINT|INSPECTION|CRITICAL|FREEZER|COOLER|LIMITS|LOG|WAS TAKEN/;
function ycParseTrailers(text){
  var out=[], seen={};
  text.split(/\n/).forEach(function(line){
    var up = line.toUpperCase();
    if(YC_STOPWORDS.test(up)) return;
    var toks = up.trim().split(/\s+/).map(function(t){
      return t.replace(/[^A-Z0-9:\/.-]/g,'');
    }).filter(Boolean);
    if(!toks.length) return;
    // find trailer token
    var ti=-1;
    for(var i=0;i<Math.min(toks.length,2);i++){
      if(/^[A-Z]{0,2}\d{3,6}[A-Z]{0,2}$/.test(toks[i]) && /\d{3}/.test(toks[i])){ ti=i; break; }
    }
    if(ti<0) return;
    var trailer = toks[ti];
    // product: following word-like tokens, stop at readings
    var prod=[];
    for(var j=ti+1;j<toks.length && prod.length<3;j++){
      var t=toks[j];
      if(/^-?\d+(\.\d+)?$/.test(t)) break;          // temp / set point
      if(/^\d\/\d$/.test(t)) break;                  // fuel fraction
      if(/^[YN]$/.test(t) && prod.length) break;       // intact
      if(/^(N\/A|NA|NIA|MIA|MA)$/.test(t)) break;     // N/A scrawl
      if(!/[A-Z]/.test(t) && !/^\d+:\d+$/.test(t)) break;
      prod.push(t);
    }
    if(!seen[trailer]){ seen[trailer]=1;
      var r = ycRowBlank(); r.trailer=trailer; r.product=prod.join(' ');
      out.push(r); }
  });
  return out.slice(0,40);
}
function ycPhotoScore(text){
  var up=text.toUpperCase();
  return ycParseTrailers(text).length
    + (up.indexOf('TRAILER')>=0?2:0) + (up.indexOf('PRODUCT')>=0?2:0)
    + (up.indexOf('INSPECTION')>=0?2:0);
}
async function ycImportPhoto(file){
  try{
    ocrStatus('📷 Preparing photo…');
    var im = await loadImageFile(file);
    var worker = await getWorker();
    await worker.setParameters({tessedit_pageseg_mode:'4'});
    var bestRot=0,bestScore=-1,bestText='';
    for(var k=0;k<4;k++){
      var rot=k*90;
      ocrStatus('🧭 Checking orientation '+(k+1)+'/4…');
      var small=preprocess(drawToCanvas(im,1800,rot));
      var res=await worker.recognize(small);
      var sc=ycPhotoScore(res.data.text);
      if(sc>bestScore){ bestScore=sc; bestRot=rot; bestText=res.data.text; }
      if(sc>=8) break;
    }
    if(bestScore<1){
      await worker.setParameters({tessedit_pageseg_mode:'6'});
      ocrStatus(null);
      toast('Could not find a trailer list in that photo. Try flatter and sharper.'); return;
    }
    ocrStatus('🔎 Reading the trailer list at full quality…');
    var big=preprocess(drawToCanvas(im,2600,bestRot));
    var res2=await worker.recognize(big);
    await worker.setParameters({tessedit_pageseg_mode:'6'});
    ocrStatus(null);
    var rows = ycParseTrailers(res2.data.text);
    // merge in extras from the quick pass, skipping near-duplicates (truncated/misread variants)
    function ycNearTrailer(a,b){
      if(a===b) return true;
      if(a.length>=3 && (a.indexOf(b)>=0 || b.indexOf(a)>=0)) return true;
      if(a.length===b.length){ var d=0;
        for(var q=0;q<a.length;q++) if(a[q]!==b[q]) d++;
        return d<=1; }
      return false;
    }
    ycParseTrailers(bestText).forEach(function(r){
      if(!rows.some(function(x){return ycNearTrailer(x.trailer, r.trailer);})) rows.push(r);
    });
    if(!rows.length){ toast('No trailers recognized. Try a flatter photo, or add rows by hand.'); return; }
    if(YC.rows.length && !confirm('Replace the current '+YC.rows.length+' trailer(s) with the '
        +rows.length+' found in the photo?')) return;
    YC.rows = rows;
    ycSaveDraft(); renderYard();
    toast('📷 Found '+rows.length+' trailers. Check the list, then enter temps, fuel and the rest.');
  }catch(e){
    ocrStatus(null);
    toast('Photo reading failed: '+(e.message||e)+'. Add trailers by hand.');
  }
}
(function(){
  var f=$('ycfile'); if(!f) return;
  f.addEventListener('change', function(){
    var file=this.files[0]; if(!file) return;
    if(!YC) ycLoadDraft();
    ycImportPhoto(file); this.value='';
  });
})();

/* ======================= receiving office: trailer blocks ======================= */
function blockSlots(){
  /* the office loads for any check in the coming day, not just the live shift */
  return YC_SLOTS.slice();
}
function blockRender(){
  var sel=$('bk_slot'); if(!sel) return;
  var cur = sel.value;
  sel.innerHTML = blockSlots().map(function(s){
    var rec = ycSlotRecord(s), done = ycSlotCheck(s);
    var note = done? ' — completed' : (rec? ' — released':'');
    return '<option value="'+s+'"'+(s===cur?' selected':'')+'>'
      + s.slice(0,2)+':'+s.slice(2)+esc(note)+'</option>';
  }).join('');
  if(!cur){
    /* default to the next check that has not been released */
    var next = blockSlots().filter(function(s){ return !ycSlotRecord(s) && !ycSlotWindowClosed(s); })[0];
    if(next) sel.value = next;
  }
  blockStatus();
  var h=$('bk_hist');
  if(h){
    var t = ycTodayISO();
    var rows = (DB.yardslots||[]).filter(function(r){ return r && r.date===t; })
      .sort(function(a,b){ return a.slot<b.slot?-1:1; });
    h.innerHTML = rows.length
      ? rows.map(function(r){
          var n = ycSlotTrailers(r);
          return '<div class="histitem"><div>'
            + '<div class="t1">'+esc(r.slot.slice(0,2)+':'+r.slot.slice(2))+' &middot; '
            +   n+' trailer'+(n===1?'':'s')+'</div>'
            + '<div class="t2">released '+esc(ycHHMM(r.loadedAt))
            +   (r.loadedBy? ' by '+esc(String(r.loadedBy).split('@')[0]) : '')+'</div>'
            + '</div></div>';
        }).join('')
      : '<div class="empty">Nothing released yet today.</div>';
  }
  blockBadge();
}
function blockStatus(){
  var sel=$('bk_slot'), st=$('bk_status'); if(!sel||!st) return;
  var rec = ycSlotRecord(sel.value);
  st.textContent = rec
    ? 'Already released at '+ycHHMM(rec.loadedAt)+' with '+ycSlotTrailers(rec)+' trailers. Releasing again replaces it.'
    : '';
}
function blockParse(text){
  var out=[], seen={};
  String(text||'').split(/\n/).forEach(function(line){
    var t = line.trim(); if(!t) return;
    var m = t.match(/^([A-Za-z0-9\-]+)[\s,;]+(.*)$/);
    var trailer = (m? m[1] : t).toUpperCase();
    var product = (m? m[2] : '').trim().toUpperCase();
    if(!trailer || seen[trailer]) return;
    seen[trailer]=1;
    out.push({ trailer:trailer, product:product });
  });
  return out;
}
function blockRelease(){
  var sel=$('bk_slot'); if(!sel) return;
  var slot = sel.value;
  var trailers = blockParse($('bk_list').value);
  if(!trailers.length){ toast('Add at least one trailer'); return; }
  var rec = ycSlotRecord(slot);
  if(rec && !confirm('The '+slot.slice(0,2)+':'+slot.slice(2)+' check was already released with '
      + ycSlotTrailers(rec)+' trailers. Replace it?')) return;
  var date = ycSlotDate(slot);
  var entry = { id: date+'_'+slot, date: date, slot: slot,
    loadedAt: new Date().toISOString(),
    loadedBy: (window.CLOUD && CLOUD.user && CLOUD.user.email) || '',
    count: trailers.length, trailers: trailers };
  DB.yardslots = (DB.yardslots||[]).filter(function(r){ return !(r && r.date===date && r.slot===slot); });
  DB.yardslots.unshift(entry);
  ycSlotsPersist();
  if(window.blockCloudSave) blockCloudSave(entry);
  $('bk_list').value='';
  blockRender();
  toast('Released '+trailers.length+' trailer'+(trailers.length===1?'':'s')+' for '
    + slot.slice(0,2)+':'+slot.slice(2)+'. The officer has one hour.');
}
function blockBadge(){
  var b=$('blockbadge'); if(!b) return;
  /* checks still to be released before their time comes round */
  var n = blockSlots().filter(function(s){
    return !ycSlotRecord(s) && !ycSlotCheck(s) && !ycSlotWindowClosed(s);
  }).length;
  b.textContent = n? String(n):''; b.hidden = !n;
}
function officeStat(){
  var el=$('officestat'); if(!el) return;
  var t=ycTodayISO();
  var released = (DB.yardslots||[]).filter(function(r){ return r && r.date===t; }).length;
  el.textContent = (DB.orders? DB.orders.length : 0)+' orders loaded · '
    + released+' yard check'+(released===1?'':'s')+' released today';
  blockBadge();
}
(function(){
  var s=$('bk_slot'); if(s) s.addEventListener('change', blockStatus);
})();

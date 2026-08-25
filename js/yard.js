
/* Checkpoint · https://gatecheck-martinbrower.netlify.app */

/* =================== YARD CHECK (F-US399-QS-36 Trailer Inspection Log) =================== */
DB.yardchecks = [];
try{ var _yc0 = sget('gc_ycs'); if(_yc0) DB.yardchecks = JSON.parse(_yc0); }catch(e){}
function ycPersistAll(){ try{ sset('gc_ycs', JSON.stringify(DB.yardchecks.slice(0,40))); }catch(e){} }

var YC_SLOTS = ['0000','0200','0400','0600','0800','1000','1200','1400','1600','1800','2000','2200'];
var YC_FUELS = ['FULL','3/4','1/2','1/4','EMPTY'];
/* The set point is only there to say which rule applies: -10 means the frozen
   band (0.0 or less), 34 means the refrigerated band (34.0 to 40.0). DEF and
   OFF are states of the unit, not temperatures. Anything else is typed. */
var YC_SETPOINTS = ['-10','34','DEF','OFF'];
/* A trailer is either on a dock door - always even, 2 up to 46 - or sitting in
   the yard on no door at all. */
var YC_DOORS = ['N/A'];
for(var _d=2; _d<=46; _d+=2) YC_DOORS.push(String(_d));
var YC = null;

function ycBlank(){
  var d = new Date();
  var slot = YC_SLOTS[Math.floor(d.getHours()/2) % 12];
  return { date: d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'),
    time: slot, name: getOfficerName(), rows: [] };
}
function ycRowBlank(){ return {trailer:'',product:'',set:'',temp:'',type:'',fuel:'',intact:'',door:'',action:''}; }
/* Every check keeps its own draft. One shared draft meant the trailers typed
   for the 00:00 check turned up on the 02:00 one. */
function _ycKey(y){ return (y && y.date && y.time) ? y.date+'_'+y.time : ''; }
function ycDrafts(){
  try{ return JSON.parse(sget('gc_ycdrafts')||'{}') || {}; }catch(e){ return {}; }
}
function ycSaveDraft(){
  try{
    sset('gc_ycdraft', JSON.stringify(YC));            /* what is open now */
    var k = _ycKey(YC); if(!k || YC_VIEW) return;
    var all = ycDrafts();
    all[k] = YC;
    var keys = Object.keys(all).sort();
    while(keys.length > 24) delete all[keys.shift()];   /* two days of checks */
    sset('gc_ycdrafts', JSON.stringify(all));
  }catch(e){}
}
function ycDraftFor(date, slot){
  var d = ycDrafts()[date+'_'+slot];
  return (d && d.rows) ? d : null;
}
function ycLoadDraft(){
  try{ var d=sget('gc_ycdraft'); if(d){ YC=JSON.parse(d); return; } }catch(e){}
  YC = ycBlank();
}

/* ---------- rules ---------- */
function ycIsTenth(v){ return /^-?\d+\.\d$/.test(String(v).trim()); }
function ycIsNumLoose(v){ return /^-?\d+(\.\d)?$/.test(String(v).trim()); }
function ycAutoType(row){
  var v = String(row.set).toUpperCase();
  if(v==='DEF' || v==='OFF') return v==='OFF' ? '' : (row.type||'');
  if(ycIsNumLoose(row.set)){ return parseFloat(row.set) <= 0 ? 'FROZEN' : 'COOLER'; }
  return row.type||'';
}
/* ---------- a unit that is switched off ----------
   There is no temperature to read, no band to judge it against, and nothing
   its fuel gauge or its door number can tell anybody that matters. The sheet
   records a dash in each, which is what the paper one gets written on it, and
   the row is an escalation on the strength of the unit being off at all. */
var YC_DASH = '\u2014';
var YC_OFF_FIELDS = ['temp','fuel','intact','door'];
function ycIsOff(row){ return String(row && row.set || '').trim().toUpperCase() === 'OFF'; }
function ycOffFill(row){
  if(!row) return false;
  var before = YC_OFF_FIELDS.map(function(k){ return row[k]; }).join('\u0000');
  if(ycIsOff(row)) YC_OFF_FIELDS.forEach(function(k){ row[k] = YC_DASH; });
  else YC_OFF_FIELDS.forEach(function(k){ if(row[k] === YC_DASH) row[k] = ''; });
  return before !== YC_OFF_FIELDS.map(function(k){ return row[k]; }).join('\u0000');
}
function ycBadFields(row){
  var out={}, f=String(row.fuel||'').toUpperCase(), v=String(row.set||'').trim().toUpperCase();
  if(v==='DEF') out.set=1;
  if(v==='OFF'){ out.set=1; return out; }   /* the dashes are not readings */
  if(String(row.temp||'').trim().toUpperCase()==='DEF') out.temp=1;
  if(f==='1/4'||f==='E'||f==='EMPTY') out.fuel=1;
  if(!out.temp && ycIsTenth(row.temp)){
    var t=parseFloat(row.temp), ty=row.type||ycAutoType(row);
    if((ty==='FROZEN' && t>=0.05) || (ty==='COOLER' && (t<33.95||t>40.05))) out.temp=1;
  }
  return out;
}
function ycEval(row){
  var reasons = [];
  var setV = String(row.set).trim().toUpperCase();
  var tmpDef = String(row.temp).trim().toUpperCase()==='DEF';
  if(setV==='DEF' || tmpDef) reasons.push('DEF (DEFROST) SHOWING');
  /* a unit that is switched off is a problem in itself: there is no band to
     judge the temperature against, and that is exactly the point */
  if(setV==='OFF') reasons.push('UNIT OFF');
  if(!tmpDef && ycIsTenth(row.temp)){
    var t = parseFloat(row.temp);
    var type = row.type || ycAutoType(row);
    if(type==='FROZEN' && t >= 0.05) reasons.push('TEMP OUT OF RANGE: frozen must be 0.0° or less');
    if(type==='COOLER' && (t < 33.95 || t > 40.05)) reasons.push('TEMP OUT OF RANGE: cooler must be 34.0° to 40.0°');
  }
  var f = String(row.fuel||'').toUpperCase();
  /* 'E' is how older checks recorded an empty tank */
  if(f==='1/4' || f==='E' || f==='EMPTY') reasons.push('LOW FUEL: ¼ tank or less');
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
/* ---- what the receiving office is waiting on ----
   The office released a trailer list; the officer files the check. The office
   should hear about it without watching the board, and should be able to open
   it, read it and print it from the notice. */
function bkSeen(){
  try{ var v = JSON.parse(sget('gc_bkseen') || '[]'); return Array.isArray(v) ? v : []; }
  catch(e){ return []; }
}
function bkMarkSeen(key){
  var seen = bkSeen();
  if(seen.indexOf(key) < 0) seen.push(key);
  try{ sset('gc_bkseen', JSON.stringify(seen.slice(-120))); }catch(e){}
}
function bkFresh(){
  var seen = bkSeen();
  return (DB.yardchecks || []).filter(function(c){
    return c && c.date && c.time && seen.indexOf(c.date + '_' + c.time) < 0;
  }).slice(0, 12);
}
function bkFreshCount(){ return bkFresh().length; }
function notifCheckGo(date, slot){
  notifClose();
  bkMarkSeen(date + '_' + slot);
  if(typeof ycUpdateBadge === 'function') ycUpdateBadge();
  go('block', false, slot);
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
var _ycBellWas = 0;
function ycUpdateBadge(){
  var bell=$('notif'); if(!bell) return;
  var office = (typeof isOffice==='function' && isOffice());
  /* the officer is told what is due; the office is told what has been filed */
  var n = office ? (blockDue().length + bkFreshCount()) : ycActionable();
  /* a schedule the office has replaced counts too: it is the same bell */
  if(!office) n += (typeof DB !== 'undefined' && DB.notes) ? DB.notes.length : 0;
  var dot=$('notifn');
  if(dot){ dot.textContent = n ? String(n) : ''; dot.hidden = !n; }
  bell.hidden = !n;
  if(!n) notifClose();
  var p = $('notifpanel'); if(p && !p.hidden) notifRender();
  bell.setAttribute('aria-label',
    n===1 ? 'One notification' : n+' notifications');
  /* it only rings when the number goes up: a standing count is not news */
  if(n > _ycBellWas){
    bell.classList.remove('ring');
    void bell.offsetWidth;
    bell.classList.add('ring');
  }
  _ycBellWas = n;
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
/* A check still to be done opens as tabs, one trailer at a time. A check
   already saved opens as the sheet it was filed as. */
function ycOpenSlot(slot){
  go(ycSlotCheck(slot) ? 'yardsheet' : 'ycgrid', false, slot);
}
/* Loading the slot is separate from navigating to it, so a refresh on
   #yardsheet/0800 brings back the same check rather than an empty sheet. */
function ycRestoreSlot(slot){
  if(!YC) ycLoadDraft();
  if(YC_VIEW === slot) return;
  /* Only skip when there is work in progress for this slot. A blank draft
     already carries the current slot's time, so without the row check the
     trailers the office released would never be loaded at all. */
  if(!YC_VIEW && YC && YC.time === slot && YC.rows.length && !ycSlotCheck(slot)) return;
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
    var date = ycSlotDate(slot);
    /* the slot fixes the date and time; the signed-in officer fixes the name */
    if(prevTime !== slot) ycSaveDraft();          /* keep the check being left */
    YC.time = slot;
    YC.date = date;
    YC.name = getOfficerName();
    var rec = ycSlotRecord(slot);
    if(prevTime !== slot){
      /* whatever was typed for another check stays with that check */
      var mine = ycDraftFor(date, slot);
      if(mine) YC.rows = mine.rows;
      else if(rec && rec.trailers && rec.trailers.length){
        YC.rows = rec.trailers.map(ycFixPair).map(function(t){
          return { trailer:(t.trailer||'').toUpperCase(), product:(t.product||'').toUpperCase(),
                   set:'', temp:'', type:'', fuel:'', intact:'', door:'', action:'' };
        });
      } else YC.rows = [];
    } else if(!YC.rows.length && rec && rec.trailers && rec.trailers.length){
      YC.rows = rec.trailers.map(ycFixPair).map(function(t){
        return { trailer:(t.trailer||'').toUpperCase(), product:(t.product||'').toUpperCase(),
                 set:'', temp:'', type:'', fuel:'', intact:'', door:'', action:'' };
      });
    }
    ycSaveDraft();
  }
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
    + '<th style="min-width:150px">*ESCALATE*</th></tr>';
  var body = YC.rows.map(function(r,i){ return ycRowHTML(r,i); }).join('');
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
  var bad = ycBadFields(r);
  var m = function(k){ return bad[k] ? ' class="bad"' : ''; };
  if(YC_VIEW){
    return '<tr id="ycr'+i+'">'
      + ycCell(String(r.trailer||'').toUpperCase()) + ycCell(String(r.product||'').toUpperCase())
      + '<td class="ycro'+(bad.set?' bad':'')+'">'+esc(r.set||'')+'</td>'
      + '<td class="ycro'+(bad.temp?' bad':'')+'">'+esc(r.temp||'')+'</td>'
      + '<td class="ycro'+(bad.fuel?' bad':'')+'">'+esc(r.fuel||'')+'</td>'
      + ycCell(r.intact) + ycCell(r.door)
      + '<td id="ycb'+i+'"></td></tr>';
  }
  var off = ycIsOff(r);
  return '<tr id="ycr'+i+'"'+(off?' class="ycoff"':'')+'>'
    +'<td><input style="font-weight:800;text-transform:uppercase" placeholder="LR7524" value="'+esc(r.trailer)+'" oninput="ycSet('+i+',\'trailer\',this.value,true)"></td>'
    +'<td><input style="text-transform:uppercase" placeholder="FRIES" value="'+esc(r.product)+'" oninput="ycSet('+i+',\'product\',this.value,true)"></td>'
    +'<td'+m('set')+'><input value="'+esc(r.set)+'" oninput="ycSet('+i+',\'set\',this.value,true)" onblur="ycBlurSet('+i+',this)"></td>'
    + (off
        ? ycCell(YC_DASH) + ycCell(YC_DASH) + ycCell(YC_DASH) + ycCell(YC_DASH)
        : '<td'+m('temp')+'><input inputmode="decimal" autocomplete="off" value="'+esc(r.temp)+'" oninput="ycSet('+i+',\'temp\',this.value,true)" onblur="ycBlurTemp('+i+',this)"></td>'
          +'<td'+m('fuel')+'>'+ycSelHTML(i,'fuel',YC_FUELS,r.fuel)+'</td>'
          +'<td>'+ycSelHTML(i,'intact',['Y','N'],r.intact)+'</td>'
          +'<td><input placeholder="N/A" value="'+esc(r.door)+'" oninput="ycSet('+i+',\'door\',this.value,true)"></td>')
    +'<td id="ycb'+i+'"></td>'
    +'</tr>';
}
/* Every input on the sheet calls this, and it did not exist: typing into the
   review sheet threw on each keystroke and changed nothing. */
function ycSet(i, k, v, save){
  var r = YC.rows[i]; if(!r) return;
  r[k] = v;
  var reshape = false;
  if(k === 'set'){ r.type = ycAutoType(r); reshape = ycOffFill(r); }
  if(save) ycSaveDraft();
  /* redrawing the whole sheet on a keystroke would take the cursor with it,
     so only the escalate cell moves - unless the row changed shape */
  if(reshape){ renderYard(); return; }
  ycBanner(i);
  ycSummary();
}
/* tidy up on the way out of a box, never while somebody is still typing in it */
function ycBlurSet(i, el){
  var r = YC.rows[i]; if(!r || !el) return;
  var v = String(el.value || '').trim().toUpperCase();
  if(v !== String(r.set || '')){ ycSet(i, 'set', v, true); el.value = v; }
  if(ycIsOff(r)) renderYard();
}
function ycBlurTemp(i, el){
  var r = YC.rows[i]; if(!r || !el) return;
  var v = String(el.value || '').trim();
  if(/^-?\d+(\.\d+)?$/.test(v)) v = parseFloat(v).toFixed(1);   /* the sheet reads to a tenth */
  else v = v.toUpperCase();
  if(v !== String(r.temp || '')){ ycSet(i, 'temp', v, true); el.value = v; }
}

/* One word. The reason is shown by the box that caused it, not spelled out. */
function ycBanner(i){
  var r = YC.rows[i], el = $('ycb'+i), tr = $('ycr'+i); if(!el) return;
  var esc_n = ycEval(r).length;
  if(tr) tr.classList.toggle('esc', esc_n>0);
  el.className = esc_n ? 'escyes' : 'escno';
  el.textContent = esc_n ? 'Escalate' : 'N/A';
}
function ycSummary(){
  var n = YC.rows.length, esc_n = 0;
  YC.rows.forEach(function(r){ if(ycEval(r).length) esc_n++; });
  $('ycsum').innerHTML = n? ('<b>'+n+'</b> trailer'+(n>1?'s':'')+' · '
    +(esc_n? '<span style="color:var(--red);font-weight:800">'+esc_n+' escalation'+(esc_n>1?'s':'')+'</span>'
           : '<span style="color:var(--green);font-weight:700">no escalations</span>')) : '';
}
function invalidateYcPreview(){}

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
        fuel:r.fuel,intact:r.intact,door:r.door,action:r.action,escalate:reasons,
        /* who it was raised with; the call is external, the record is not */
        escTo: reasons.length ? (r.escTo || ycEscalateRoute()) : ''}; }) };
}
function ycFmtDate(iso){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(iso||'')) return iso||'';
  var p=iso.split('-'); return p[1]+'/'+p[2]+'/'+p[0];
}
/* ---------- render the paper log ---------- */
/* ---------- the printed form ----------
   This is the F-US399-QS-36 log as it is printed, filled in by typing instead
   of by hand. Nothing is on it that is not on the paper: no running count of
   escalations, no tick beside a row that was fine, no restating of the rule,
   no line saying which app made it. The ESCALATE column reads N/A or
   Escalate, and that is all it has ever read on paper.

   What the officer typed as the action taken is kept on the record and shown
   in the app; it is not printed, because the paper form has no box for it. */
var _ycLogo = null;
function drawYardPaper(d, done){
  var cv=$('paper'), g=cv.getContext('2d');
  g.setTransform(1,0,0,1,0,0);
  g.fillStyle='#fff'; g.fillRect(0,0,1275,1650);
  function txt(t,x,y,size,bold,italic,center,color){
    g.fillStyle=color||'#111';
    g.font=(italic?'italic ':'')+(bold?'bold ':'')+size+'px Arial';
    g.textAlign=center?'center':'left'; g.fillText(t,x,y); g.textAlign='left'; g.fillStyle='#111';
  }
  function body(){
    txt('"F-US399-QS-36 Trailer Inspection Log"',637,132,32,true,false,true);
    txt('Air temperature critical limits: Freezer 0\u00b0 or less/Cooler: 34.0\u00b0-40.0\u00b0',
        637,166,20,false,false,true);
    txt('DATE: '+ycFmtDate(d.date),60,215,24,true);
    txt('TIME: 00, 02, 04, 06, 08, 10, 12, 14, 16, 18, 20, 22',60,248,22,true);
    txt('Time: '+d.time,60,281,24,true);
    txt('NAME: '+(d.name||''),60,314,24,true);

    var cols = [
      {k:'trailer', t:'TRAILER#', x:60,  w:130},
      {k:'product', t:'PRODUCT', x:190, w:170},
      {k:'set',     t:'TEMP SET POINT', x:360, w:150},
      {k:'temp',    t:'TEMP', x:510, w:110},
      {k:'fuel',    t:'FUEL', x:620, w:90},
      {k:'intact',  t:'INTACT (Y or N)', x:710, w:110},
      {k:'door',    t:'DOOR #', x:820, w:100},
      {k:'act',     t:'*ESCALATE*', x:920, w:295}
    ];
    var top=350, headH=48;
    var n = Math.max(1, d.rows.length);
    var rowH = Math.max(34, Math.min(58, Math.floor((1580-top-headH)/n)));
    var bottom = top+headH+rowH*d.rows.length;
    g.strokeStyle='#333'; g.lineWidth=1.4;
    g.strokeRect(60, top, 1155, headH+rowH*d.rows.length);
    cols.forEach(function(c,ci){ if(ci){ g.beginPath(); g.moveTo(c.x,top); g.lineTo(c.x,bottom); g.stroke(); } });
    for(var r=0;r<=d.rows.length;r++){ var y=top+headH+r*rowH;
      g.beginPath(); g.moveTo(60,y); g.lineTo(1215,y); g.stroke(); }
    cols.forEach(function(c){
      var words=c.t.split(' ');
      if(words.length>1 && c.t.length>11){
        txt(words.slice(0,Math.ceil(words.length/2)).join(' '), c.x+c.w/2, top+20, 15, true, false, true);
        txt(words.slice(Math.ceil(words.length/2)).join(' '), c.x+c.w/2, top+40, 15, true, false, true);
      } else txt(c.t, c.x+c.w/2, top+30, 16, true, false, true);
    });
    var fs = rowH>=46? 19 : 16;
    d.rows.forEach(function(r,i){
      var y = top+headH+i*rowH+Math.round(rowH/2)+6;
      var bad = r.escalate && r.escalate.length>0;
      txt(String(r.trailer||'').toUpperCase(), cols[0].x+cols[0].w/2, y, fs, true, false, true);
      txt(String(r.product||'').toUpperCase(), cols[1].x+cols[1].w/2, y, fs-2, false, false, true);
      txt(String(r.set||'').toUpperCase(), cols[2].x+cols[2].w/2, y, fs, false, false, true);
      txt(String(r.temp||'').toUpperCase(), cols[3].x+cols[3].w/2, y, fs, false, false, true);
      txt(String(r.fuel||''), cols[4].x+cols[4].w/2, y, fs, false, false, true);
      txt(String(r.intact||''), cols[5].x+cols[5].w/2, y, fs, false, false, true);
      txt(String(r.door||''), cols[6].x+cols[6].w/2, y, fs, false, false, true);
      /* N/A, or Escalate in red. Nothing else goes in this column. */
      txt(bad? 'Escalate' : 'N/A', cols[7].x+cols[7].w/2, y, fs, bad, false, true,
          bad? '#C0392B' : '#111');
    });
    done(cv);
  }
  /* the sheet is headed the way the printed one is */
  if(_ycLogo && _ycLogo.complete && _ycLogo.naturalWidth){
    var h = 54, w = Math.round(_ycLogo.naturalWidth * (h/_ycLogo.naturalHeight));
    g.drawImage(_ycLogo, Math.round(637 - w/2), 40, w, h);
    body();
    return;
  }
  var im = _ycLogo || new Image();
  _ycLogo = im;
  im.onload = function(){
    var h = 54, w = Math.round(im.naturalWidth * (h/im.naturalHeight));
    g.drawImage(im, Math.round(637 - w/2), 40, w, h);
    body();
  };
  im.onerror = function(){ body(); };
  if(!im.src) im.src = 'assets/mb-logo.png';
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
/* The reading and the landing are separate: the officer's photo fills their
   draft, the office's photo fills the list they are about to release. Same
   reader either way. */
async function ycPhotoTrailers(file){
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
      toast('Could not find a trailer list in that photo. Try flatter and sharper.');
      return [];
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
    if(!rows.length) toast('No trailers recognized. Try a flatter photo, or add rows by hand.');
    return rows;
  }catch(e){
    ocrStatus(null);
    toast('Photo reading failed: '+(e.message||e)+'. Add trailers by hand.');
    return [];
  }
}
/* the officer's own draft */
async function ycImportPhoto(file){
  var rows = await ycPhotoTrailers(file);
  if(!rows || !rows.length) return;
  if(!YC) ycLoadDraft();
  if(YC.rows.length && !confirm('Replace the current '+YC.rows.length+' trailer(s) with the '
      +rows.length+' found in the photo?')) return;
  YC.rows = rows;
  ycSaveDraft(); renderYard();
  if(typeof renderYcGrid === 'function') renderYcGrid();
  toast('📷 Found '+rows.length+' trailers. Check the list, then enter temps, fuel and the rest.');
}

/* ======================= receiving office: trailer blocks ======================= */
function blockSlots(){
  /* the office loads for any check in the coming day, not just the live shift */
  return YC_SLOTS.slice();
}
/* Which check the office should load next: the first that has not been
   released and whose hour has not already gone by. */
function blockNext(){
  return blockSlots().filter(function(s){
    return !ycSlotRecord(s) && !ycSlotWindowClosed(s);
  })[0] || '';
}
function blockSlotState(slot){
  if(ycSlotCheck(slot))  return { cls:'done', label:'Completed' };
  if(ycSlotRecord(slot)) return { cls:'rel',  label:'Released' };
  if(slot === blockNext()) return { cls:'next', label:'Load this one' };
  return { cls:'', label: ycSlotWindowClosed(slot) ? 'Not loaded' : 'Not loaded yet' };
}
/* The office reads the same playing cards the officer does: same shape, same
   palette, same words on top. Only the states differ, because loading a check
   is a different job from working one. */
function blockTile(slot){
  var chk = ycSlotCheck(slot), rec = ycSlotRecord(slot);
  var next = slot === blockNext();
  var n = rec ? ycSlotTrailers(rec) : 0;
  var st;
  if(chk){
    var escN = (chk.rows||[]).filter(function(r){ return r.escalate && r.escalate.length; }).length;
    /* Amber is the escalation colour, so a tile that says Completed in amber
       is telling two different stories. The word follows the colour. */
    st = escN
      ? { cls:'esc', top:'Escalations', arrow:'\u26a0',
          kpi: escN+' of '+(chk.rows||[]).length,
          detail:'Filed, with '+escN+' escalation'+(escN===1?'':'s') }
      : { cls:'done', top:'Completed', arrow:'\u2713',
          kpi:(chk.rows||[]).length+' checked',
          detail:'The officer has filed this check' };
  } else if(rec){
    st = { cls:'ready', top:'Released', arrow:'\u2192', kpi:n+' trailer'+(n===1?'':'s'),
           detail:'Released at '+ycHHMM(rec.loadedAt)+', waiting on the officer' };
  } else if(next){
    st = { cls:'due', top:'Load this one', arrow:'\u2191', kpi:'Add list',
           detail:'This is the next check to release' };
  } else {
    st = { cls:'past', top:'Not loaded', arrow:'\u2014', kpi:'\u2014',
           detail:'No trailer list released' };
  }
  var hh = slot.slice(0,2);
  return '<button class="slot '+st.cls+(next?' glow':'')+'"'
    + ' aria-label="'+esc(hh+':00 \u2014 '+st.top+', '+st.detail)+'"'
    + ' title="'+esc(hh+':00 \u2014 '+st.detail)+'"'
    + ' onclick="blockPick(\''+slot+'\')">'
    + '<span class="top">'+esc(st.top)+'</span>'
    + '<span class="hero"><b>'+hh+'</b></span>'
    + '<span class="band"><span class="arw" aria-hidden="true">'+st.arrow+'</span>'
    +   '<span class="kpi">'+esc(st.kpi)+'</span></span>'
    + '</button>';
}
function blockRender(){
  var am = $('bk_am'), pm = $('bk_pm');
  if(am) am.innerHTML = YC_SHIFT_AM.map(blockTile).join('');
  if(pm) pm.innerHTML = YC_SHIFT_PM.map(blockTile).join('');
  var key = $('bk_key');
  if(key) key.innerHTML = [['due','Load this one'], ['ready','Released'],
      ['done','Completed'], ['esc','Escalations'], ['past','Not loaded']]
    .map(function(k){ return '<span class="lg '+k[0]+'"><i></i>'+k[1]+'</span>'; }).join('');

  var sel=$('bk_slot');
  if(sel){
    var cur = sel.value;
    sel.innerHTML = blockSlots().map(function(s){
      var rec = ycSlotRecord(s), done = ycSlotCheck(s);
      var note = done? ' \u2014 completed' : (rec? ' \u2014 released':'');
      return '<option value="'+s+'"'+(s===cur?' selected':'')+'>'
        + ycSlotLabel(s)+esc(note)+'</option>';
    }).join('');
    if(cur) sel.value = cur;
  }
  blockStatus();
}
/* The board and a single check are two places, so the browser's own back
   button walks between them and no in-app button has to. */
function blockPick(slot){
  /* opening it from the board counts as having read it */
  var chk = ycSlotCheck(slot);
  if(chk){
    bkMarkSeen(chk.date + '_' + chk.time);
    if(typeof ycUpdateBadge === 'function') ycUpdateBadge();
  }
  go('block', false, slot);
}
function blockBoard(){ go('block'); }
function blockViewSync(sub){
  var board = $('bkboard'), load = $('bkload'), view = $('bkview');
  if(!board) return;
  var slot = String(sub||'').trim();
  var chk = slot ? ycSlotCheck(slot) : null;

  if(view){
    view.hidden = !chk;
    document.body.classList.toggle('dayview-open', !!chk);
    if(chk){
      $('bkview_title').textContent = ycSlotLabel(chk.time) + ' yard check';
      ycCheckRender(chk, $('bkview_body'));
      var b=$('bkview_back'); if(b) b.focus();
    }
  }
  board.hidden = !!slot;
  if(load){
    load.hidden = !slot || !!chk;
    if(!load.hidden){
      var sel=$('bk_slot'); if(sel) sel.value = slot;
      var rec = ycSlotRecord(slot);
      $('bk_title').textContent = 'Load the ' + ycSlotLabel(slot) + ' yard check';
      var t=$('bk_list');
      if(t){
        /* the list already released is what the office edits, not a blank box */
        t.value = rec ? (rec.trailers||[]).map(function(x){
          return x.trailer + (x.product ? ', ' + x.product : ''); }).join('\n') : '';
      }
      blockStatus();
    }
  }
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
    /* A comma or a tab is what separates the trailer from the product. Without
       one, "LR 7540" is a trailer number typed with a space in it, not a
       trailer called LR carrying a product called 7540. */
    var trailer, product = '';
    var d = t.match(/^([^,;\t]+)[,;\t]+(.*)$/);
    if(d){ trailer = d[1]; product = d[2]; }
    else {
      var w = t.match(/^(\S+)\s+(.*)$/);
      if(w && /\d/.test(w[1]) && /[A-Za-z]/.test(w[2])){ trailer = w[1]; product = w[2]; }
      else trailer = t.replace(/\s+/g, '');
    }
    trailer = String(trailer).trim().toUpperCase();
    product = String(product).trim().toUpperCase();
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
  blockBoard();
  toast('Released '+trailers.length+' trailer'+(trailers.length===1?'':'s')+' for '
    + slot.slice(0,2)+':'+slot.slice(2)+'. The officer has one hour.');
}
/* The office is told fifteen minutes before a check is due, so the trailer
   list is out before the officer needs it. The tile carries no number: the
   bell in the header is where news lives. */
var BK_LEAD_MIN = 15;
function blockDue(){
  var now = new Date(), m = now.getHours()*60 + now.getMinutes();
  return blockSlots().filter(function(s){
    if(ycSlotRecord(s)) return false;
    var at = parseInt(s.slice(0,2),10) * 60;
    var away = at - m;
    if(away < -60) away += 1440;          /* the next one round the clock */
    return away <= BK_LEAD_MIN && away > -60;
  });
}
/* One function owns the bell. This used to set it itself, and then fought
   ycUpdateBadge for the same element - the office ended up with whichever
   ran last. */
function blockBadge(){ ycUpdateBadge(); }
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

/* ================= the officer's check, trailer by trailer =================
   The board sends the officer here, not to the full sheet. One tab per trailer
   released for the slot, the way a streaming app lays out its rows; tapping one
   opens a card with only that trailer's boxes on it. The sheet is still the
   record, and the officer reads it whole before it goes anywhere - but nobody
   fills a nine-column grid on a phone in a cold yard.
*/
/* "LR" carrying a product called "7540" is a trailer number that was split on
   its space. Fixed at the source, and mended here for lists already released. */
function ycFixPair(r){
  var t = String(r.trailer||'').trim(), p = String(r.product||'').trim();
  if(t && p && /^\d+$/.test(p) && !/\d/.test(t)){ r.trailer = t + p; r.product = ''; }
  return r;
}
function ycSlotLabel(t){
  t = String(t||''); return t.length===4 ? t.slice(0,2)+':'+t.slice(2) : t;
}
function ycRowDone(r){
  return !!(String(r.set||'').trim() && String(r.temp||'').trim()
    && r.fuel && r.intact && String(r.door||'').trim());
}
function ycGridOpen(slot){ go('ycgrid', false, slot); }
function ycGridBack(){ go('yard'); }

var YCG_Q = '', YCG_ALL = false, YCG_FIRST = 8;
function ycGridSearch(v){ YCG_Q = String(v||'').trim().toUpperCase(); renderYcGrid(); }
function ycGridMore(){ YCG_ALL = true; renderYcGrid(); }

function renderYcGrid(){
  var host = $('ycgridwrap'); if(!host) return;
  if(!YC) ycLoadDraft();
  /* a row with no trailer number is not a trailer. These crept in before the
     card refused to keep a blank one; they are cleared out on sight. */
  var kept = (YC.rows || []).filter(function(r, k){
    return String(r.trailer||'').trim() || k === YCM;
  }).map(ycFixPair);
  if(kept.length !== (YC.rows||[]).length){ YC.rows = kept; ycSaveDraft(); }
  else YC.rows = kept;
  var rows = YC.rows;
  var done = rows.filter(ycRowDone).length;
  var escN = rows.filter(function(r){ return ycRowDone(r) && ycEval(r).length; }).length;
  var all  = rows.length > 0 && done === rows.length;

  $('ycg_slot').textContent = ycSlotLabel(YC.time);
  $('ycg_count').textContent = done + ' of ' + rows.length + ' checked'
    + (escN ? ' \u00b7 ' + escN + ' to escalate' : '');
  $('ycg_bar').style.width = (rows.length ? Math.round(done/rows.length*100) : 0) + '%';
  $('ycg_bar').className = 'ycgfill' + (all ? ' full' : '');

  /* keep each trailer's real position, so tapping a tile still opens the right
     row after the list has been filtered */
  var shown = rows.map(function(r, i){ return { r:r, i:i }; });
  /* the officer searches for a trailer, by its number */
  if(YCG_Q) shown = shown.filter(function(x){
    return String(x.r.trailer||'').toUpperCase().indexOf(YCG_Q) >= 0;
  });
  var over = 0;
  if(!YCG_Q && !YCG_ALL && shown.length > YCG_FIRST){
    over = shown.length - YCG_FIRST;
    shown = shown.slice(0, YCG_FIRST);
  }

  var tiles = shown.map(function(x){
    var r = x.r, i = x.i;
    var ok = ycRowDone(r);
    var bad = ok && ycEval(r).length;
    var state = bad ? 'Escalate' : ok ? 'Checked' : 'To do';
    return '<button type="button" class="ycgtile'
      + (bad ? ' esc' : ok ? ' done' : '') + '" onclick="ycModalOpen(' + i + ')"'
      + ' aria-label="' + esc(String(r.trailer||'Trailer '+(i+1))) + ', '
      +   esc(String(r.product||'no product')) + ', ' + state + '">'
      + (ok ? '<span class="ycgmark">' + (bad ? '\u26a0' : '\u2713') + '</span>' : '')
      + '<b>' + esc(String(r.trailer||'').toUpperCase() || '\u2014') + '</b>'
      + '<em>' + esc(String(r.product||'').toUpperCase() || 'No product') + '</em>'
      + '</button>';
  }).join('');

  host.innerHTML = tiles
    + (YCG_Q ? '' :
       '<button type="button" class="ycgtile add" onclick="ycGridAdd()"'
       + ' aria-label="Add a trailer that is not on the list">'
       + '<b>+ Add trailer</b><em>Not on the list</em></button>');
  if(YCG_Q && !shown.length)
    host.innerHTML = '<div class="ycgnone">No trailer matches \u201c' + esc(YCG_Q) + '\u201d.</div>';

  var more = $('ycg_more');
  more.hidden = !over;
  more.textContent = 'See more (' + over + ')';

  var act = $('ycg_actions');
  act.hidden = !all;
  $('ycg_review').textContent = 'Review and submit';
  var note = $('ycg_note');
  note.textContent = rows.length
    ? (all ? 'Every trailer is checked. Read the sheet before it goes to the receiving office.'
           : '')
    : 'The receiving office has not released a trailer list for this check yet. '
      + 'Add the trailers you can see in the yard.';
  note.hidden = !note.textContent;
}
function ycGridAdd(){
  YCG_Q = ''; var q=$('ycg_q'); if(q) q.value='';
  var r = ycRowBlank();
  r.added = true;          /* the officer's own, so the officer may remove it */
  YC.rows.push(r);
  ycSaveDraft();
  /* straight into the card: re-drawing the grid first would sweep the blank
     row away before the officer had a chance to type into it */
  ycModalOpen(YC.rows.length - 1);
}
function ycGridReview(){ go('yardsheet', false, YC.time); }

/* The same thing from the sheet. A truck the office never listed still turns
   up in the yard, so the officer must be able to write one in from either
   screen. This button called a function that did not exist. */
function ycAdd(){
  if(!YC) ycLoadDraft();
  var r = ycRowBlank();
  r.added = true;
  YC.rows.push(r);
  ycSaveDraft();
  renderYard();
  /* the cursor lands in the new row's trailer number, ready to type */
  var rows = document.querySelectorAll('#ycrows table tr');
  var box = rows.length && rows[rows.length - 1].querySelector('input');
  if(box) box.focus();
}

/* ---- one trailer, on a card in the middle of the screen ---- */
var YCM = -1, YCM_OTHER = false;
function ycModalOpen(i){
  if(!YC.rows[i]) return;
  YCM = i;
  YCM_OTHER = false;
  ycModalRender();
  var m = $('ycmodal');
  m.hidden = false;
  document.body.classList.add('ycmodal-open');
  var f = m.querySelector('input,select'); if(f) f.focus();
}
function ycModalClose(){
  /* a trailer the officer opened and left blank was never really added */
  var r = YC.rows[YCM];
  if(r && r.added && !String(r.trailer||'').trim()){ YC.rows.splice(YCM,1); ycSaveDraft(); }
  YCM = -1;
  var m = $('ycmodal'); if(m) m.hidden = true;
  document.body.classList.remove('ycmodal-open');
  renderYcGrid();
}
function ycmSel(k, list, cur, extra){
  return '<select id="ycm_'+k+'" onchange="ycmSet(\''+k+'\',this.value)"'
    + (extra||'') + '><option value=""></option>'
    + list.map(function(v){
        return '<option'+(String(cur)===String(v)?' selected':'')+'>'+esc(v)+'</option>'; }).join('')
    + '</select>';
}
function ycModalRender(){
  var r = YC.rows[YCM]; if(!r) return;
  var known = YC_SETPOINTS.indexOf(String(r.set)) >= 0;
  /* "Other" clears the value, so the choice itself has to be remembered or the
     box would vanish the moment it appeared */
  var other = YCM_OTHER || (String(r.set||'').trim() && !known);
  $('ycm_title').textContent = (String(r.trailer||'').toUpperCase() || 'New trailer')
    + (r.product ? ' \u2014 ' + String(r.product).toUpperCase() : '');
  function box(label, inner, cls){
    return '<div class="ycmbox'+(cls? ' '+cls : '')+'"><span>'+esc(label)+'</span>'
      + inner + '</div>';
  }
  $('ycm_body').innerHTML =
      (String(r.trailer||'').trim() ? '' :
        '<div class="ycmnew">'
        + box('Trailer #', '<input id="ycm_trailer" value="'+esc(r.trailer||'')+'"'
            + ' placeholder="LR7524" style="text-transform:uppercase"'
            + ' oninput="ycmSet(\'trailer\',this.value)">')
        + box('Product', '<input id="ycm_product" value="'+esc(r.product||'')+'"'
            + ' placeholder="FRIES" style="text-transform:uppercase"'
            + ' oninput="ycmSet(\'product\',this.value)">')
        + '</div>')
    + (r.added ? '<button type="button" class="ycmdel" onclick="ycModalDelete()">'
        + 'Remove this trailer</button>' : '')
    + '<div class="ycmrow">'
    +   box('Temp set point',
          /* Other turns this one box into a box you type in: a second box below
             it was one more thing to look at for no reason. */
          other
            ? '<input class="ycmset' + (String(r.set||'').trim() ? '' : ' want') + '"'
              + ' id="ycm_setother" value="'+esc(r.set)+'" placeholder="Other"'
              + ' oninput="ycmSet(\'set\',this.value)"'
              + ' onblur="ycmOtherOut()">'
            : ycmSel('set', YC_SETPOINTS.concat(['Other\u2026']), r.set))
    +   (ycIsOff(r)
          /* nothing below the set point means anything once the unit is off,
             so the boxes say so rather than sitting there asking to be filled */
          ? box('Temp', '<div class="ycmdash">'+YC_DASH+'</div>')
            + box('Fuel', '<div class="ycmdash">'+YC_DASH+'</div>')
            + box('Intact (Y/N)', '<div class="ycmdash">'+YC_DASH+'</div>')
            + box('Door #', '<div class="ycmdash">'+YC_DASH+'</div>')
          : box('Temp', '<input id="ycm_temp" value="'+esc(r.temp||'')+'" placeholder="-9.1"'
              /* a temperature is always figures, so the figures come up first */
              + ' inputmode="decimal" autocomplete="off"'
              + ' oninput="ycmSet(\'temp\',this.value)">')
            + box('Fuel', ycmSel('fuel', YC_FUELS, r.fuel))
            + box('Intact (Y/N)', ycmSel('intact', ['Y','N'], r.intact))
            + box('Door #', ycmSel('door', YC_DOORS, r.door)))
    +   box('Escalate', '<div class="ycmescbox" id="ycm_escbox">N/A</div>', 'esc')
    + '</div>';
  ycModalEsc();
}
/* the escalate box is never typed into: it says what the rules say */
function ycModalEsc(){
  var r = YC.rows[YCM]; if(!r) return;
  var reasons = ycEval(r);
  if(reasons.length){ if(!r.escTo) r.escTo = ycEscalateRoute(); }
  else if(r.escTo){ r.escTo = ''; }
  var cell = $('ycm_escbox'); if(!cell) return;
  /* one word, the same shape as every other box. The reason and the action
     taken belong on the sheet the officer reads before submitting, not
     crammed into a box on the card. */
  cell.textContent = reasons.length ? 'Escalate' : 'N/A';
  cell.className = 'ycmescbox' + (reasons.length ? ' on' : '');
  cell.title = reasons.length ? reasons.join(' \u00b7 ') : '';
}
/* who an escalation goes to depends on the hour: the receiving office is not
   always open, and the poster says to raise it on the walkie when it is not */
function ycEscalateOpen(now){
  var n = now || new Date(), day = n.getDay(), h = n.getHours();
  var closed = (h >= 0 && h < 5)
    || (day === 6 && h >= 14) || (day === 0 && h < 5)
    || (day === 0 && h >= 14) || (day === 1 && h < 5);
  return !closed;
}
/* Where the escalation was raised. The call itself happens on a walkie, outside
   the app, but which route was used is part of the record and is kept with the
   row - the paperwork must show it was raised, and to whom. */
function ycEscalateRoute(now){
  return ycEscalateOpen(now) ? 'DC' : 'Warehouse supervisor (walkie)';
}
function ycEscalateTo(now){
  return ycEscalateOpen(now)
    ? 'Escalate to the DC. Record what you did below.'
    : 'Receiving is closed \u2014 call the warehouse supervisor on the walkie, '
      + 'then record what you did below.';
}
/* leaving the box empty puts the list back, so nobody is stranded in "Other" */
function ycmOtherOut(){
  var r = YC.rows[YCM]; if(!r) return;
  if(!String(r.set||'').trim()){ YCM_OTHER = false; ycModalRender(); }
}
function ycmSet(k, v){
  var r = YC.rows[YCM]; if(!r) return;
  if(k==='set' && v==='Other\u2026'){ YCM_OTHER = true; r.set=''; ycSaveDraft(); ycModalRender(); return; }
  if(k==='set' && v && v!=='Other\u2026' && YC_SETPOINTS.indexOf(v)>=0) YCM_OTHER = false;
  r[k] = v;
  /* the band follows the set point, and is cleared when the unit is OFF: a
     stale band would keep judging a trailer against a rule it is no longer in */
  if(k==='set'){
    r.type = ycAutoType(r);
    if(ycOffFill(r)){ ycSaveDraft(); ycModalRender(); return; }
  }
  ycSaveDraft();
  ycModalEsc();
}
function ycModalDelete(){
  var r = YC.rows[YCM]; if(!r) return;
  var name = String(r.trailer||'').trim();
  if(name && !confirm('Remove '+name+' from this check?')) return;
  YC.rows.splice(YCM, 1);
  ycSaveDraft();
  ycModalClose();
}
function ycModalSave(){
  var r = YC.rows[YCM];
  if(r && !ycIsOff(r)){
    var t = String(r.temp||'').trim();
    if(t && t.toUpperCase()!=='DEF' && !ycIsTenth(t)){
      toast('Temp must be recorded to the tenth, e.g. -10.0');
      var el=$('ycm_temp'); if(el) el.focus();
      return;
    }
    if(t && t.toUpperCase()==='DEF') r.temp='DEF';
  }
  if(r) ycSaveDraft();
  ycModalClose();
}
document.addEventListener('keydown', function(e){
  if(e.key==='Escape' && YCM >= 0) ycModalClose();
});

/* One button closes the check: it is filed, it is emailed to the receiving
   office, and the board marks the slot done. Saving and sending as two
   separate buttons invited half-finished checks, where the office never got
   the paperwork. */
function ycSubmit(){
  var p = (typeof ycProblems === 'function') ? ycProblems() : { block: [], warn: [] };
  if(p.block && p.block.length){ toast(p.block[0]); return; }
  var d = ycData();
  var n = d.rows.length;
  var escN = d.rows.filter(function(r){ return r.escalate && r.escalate.length; }).length;
  if(!confirm('Submit this ' + ycSlotLabel(d.time) + ' yard check?\n\n'
      + n + ' trailer' + (n===1?'':'s')
      + (escN ? ', ' + escN + ' escalation' + (escN===1?'':'s') : ', no escalations')
      + '\n\nIt goes on the record and to the receiving office.')) return;
  if(typeof beep==='function') beep();
  ycSave();
  ycSendData(d);
  try{ var all = ycDrafts(); delete all[d.date+'_'+d.time];
       sset('gc_ycdrafts', JSON.stringify(all)); }catch(e){}
  YC = ycBlank(); ycSaveDraft();
  go('yard');
}


/* ---- the office reads a completed check ---- */
function blockOpenCheck(slot){ go('block', false, slot); }
function blockViewClose(){ go('block'); }
/* The check the office reads is the sheet that was filed: the same paper the
   officer previewed and the same image that was emailed. Rebuilding it as an
   HTML table gave them a third version of one document, and it read like a
   spreadsheet rather than the form. Escalated rows are red on it, because
   drawYardPaper draws them that way. */
function ycCheckMeta(d){
  var escN = (d.rows||[]).filter(function(r){ return r.escalate && r.escalate.length; }).length;
  return '<div class="bkvmeta"><b>'+esc(ycFmtDate(d.date))+' \u00b7 '+esc(ycSlotLabel(d.time))+'</b>'
    + '<span>Recorded by '+esc(d.name||'\u2014')
    + ' \u00b7 '+(d.rows||[]).length+' trailer'+((d.rows||[]).length===1?'':'s')
    + ' \u00b7 '+(escN? escN+' escalation'+(escN===1?'':'s') : 'no escalations')+'</span></div>';
}
function ycCheckRender(d, host){
  if(!host) return;
  host.innerHTML = ycCheckMeta(d) + '<div class="ycpaper" id="ycpaperwrap"></div>';
  if(typeof drawYardPaper !== 'function') return;
  drawYardPaper(d, function(cv){
    var w = host.querySelector('#ycpaperwrap');
    if(w) w.innerHTML = '<img alt="The yard check as it was filed" src="'
      + cv.toDataURL('image/png') + '">';
  });
}



/* ---- what the bell has to say ----
   Tapping it opens the message, it does not carry the officer off somewhere.
   Going to the check is a second, deliberate tap. */
function ycWaiting(){
  return ycShiftSlots().filter(function(s){
    var st = ycSlotStatus(s);
    return st.cls === 'ready' || st.cls === 'over';
  }).map(function(s){ return { slot:s, st:ycSlotStatus(s) }; });
}
/* The receiving office replacing a day is news, not an interruption: the
   officer keeps working and reads it when they look at the bell. */
function notifSched(){
  return (typeof DB !== 'undefined' && DB.notes) ? DB.notes : [];
}
function notifRender(){
  var p = $('notifpanel'); if(!p) return;
  if(typeof isOffice === 'function' && isOffice()){ notifRenderOffice(p); return; }
  var list = ycWaiting(), notes = notifSched(), html = '';
  if(notes.length){
    html += '<div class="nphd">Schedule</div>'
      + notes.map(function(n){
          return '<button type="button" class="npitem" onclick="notifSchedGo(\''+esc(n.date)+'\')">'
            + '<span class="npslot">'+esc(String(n.date).slice(8,10))+'</span>'
            + '<span class="nptxt"><b>Schedule updated</b>'
            + '<span>Receiving office \u00b7 '+esc(schedNoteText(n))+'</span></span></button>';
        }).join('');
  }
  html += '<div class="nphd">Yard checks waiting</div>'
    + (list.length
        ? list.map(function(x){
            return '<button type="button" class="npitem'+(x.st.cls==='over'?' over':'')+'"'
              + ' onclick="notifGo(\''+x.slot+'\')">'
              + '<span class="npslot">'+esc(x.slot.slice(0,2))+'</span>'
              + '<span class="nptxt"><b>'+esc(x.st.top)+'</b>'
              + '<span>'+esc(x.st.detail)+'</span></span></button>';
          }).join('')
        : '<div class="npfoot">Nothing waiting.</div>');
  if(list.length || notes.length) html += '<div class="npfoot">Tap one to open it.</div>';
  p.innerHTML = html;
}
function notifRenderOffice(p){
  var due = blockDue(), list = bkFresh(), html = '';
  if(due.length){
    html += '<div class="nphd">Trailer lists to release</div>'
      + due.map(function(slot){
          return '<button type="button" class="npitem" onclick="notifBlockGo(\''+slot+'\')">'
            + '<span class="npslot">'+esc(slot.slice(0,2))+'</span>'
            + '<span class="nptxt"><b>Needs a trailer list</b>'
            + '<span>Due at '+esc(slot.slice(0,2)+':'+slot.slice(2))+'</span></span></button>';
        }).join('');
  }
  html += '<div class="nphd">Yard checks filed</div>'
    + (list.length
        ? list.map(function(c){
            var escN = (c.rows||[]).filter(function(r){ return r.escalate && r.escalate.length; }).length;
            return '<button type="button" class="npitem'+(escN?' over':'')+'"'
              + ' onclick="notifCheckGo(\''+esc(c.date)+'\',\''+esc(c.time)+'\')">'
              + '<span class="npslot">'+esc(String(c.time).slice(0,2))+'</span>'
              + '<span class="nptxt"><b>Yard check completed</b>'
              + '<span>'+esc(c.name || 'Officer')+' \u00b7 '
              +   (escN ? escN+' escalation'+(escN===1?'':'s')
                        : (c.rows||[]).length+' checked')
              + '</span></span></button>';
          }).join('')
        : '<div class="npfoot">Nothing new.</div>');
  if(due.length || list.length) html += '<div class="npfoot">Tap one to open it.</div>';
  p.innerHTML = html;
}
function notifBlockGo(slot){ notifClose(); go('block', false, slot); }
function notifSchedGo(date){
  notifClose();
  if(typeof schedNoteRead === 'function') schedNoteRead(date);
  go('sched');
}
function notifToggle(e){
  if(e) e.stopPropagation();
  var p = $('notifpanel'), b = $('notif'); if(!p) return;
  var open = p.hidden;
  if(open) notifRender();
  p.hidden = !open;
  if(b) b.setAttribute('aria-expanded', String(open));
}
function notifClose(){
  var p = $('notifpanel'), b = $('notif');
  if(p && !p.hidden){ p.hidden = true; if(b) b.setAttribute('aria-expanded','false'); }
}
function notifGo(slot){ notifClose(); go('yard'); if(slot) ycOpenSlot(slot); }
document.addEventListener('click', function(e){
  var p = $('notifpanel');
  if(p && !p.hidden && !p.contains(e.target) && e.target.closest('#notif') === null) notifClose();
});
document.addEventListener('keydown', function(e){ if(e.key==='Escape') notifClose(); });

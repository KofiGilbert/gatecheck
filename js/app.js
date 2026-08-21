/* Checkpoint · https://gatecheck-martinbrower.netlify.app */

/* ======================= storage (falls back to memory) ======================= */
var MEM = {};
function sget(k){ try{ return localStorage.getItem(k); }catch(e){ return MEM[k]||null; } }
function sset(k,v){ try{ localStorage.setItem(k,v); }catch(e){ MEM[k]=v; } }

var DB = { orders: [], forms: [] };
(function load(){
  try{ var o = sget('gc_orders'); if(o) DB.orders = JSON.parse(o); }catch(e){}
  try{ var f = sget('gc_forms');  if(f) DB.forms  = JSON.parse(f); }catch(e){}
})();
function persist(){ sset('gc_orders', JSON.stringify(DB.orders)); sset('gc_forms', JSON.stringify(DB.forms)); }

/* ======================= helpers ======================= */
function $(id){ return document.getElementById(id); }
function toast(m){ var t=$('toast'); t.textContent=m; t.classList.add('show');
  clearTimeout(t._h); t._h=setTimeout(function(){t.classList.remove('show');},2600); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function todayStr(){ var d=new Date();
  return (d.getMonth()+1)+'/'+d.getDate()+'/'+String(d.getFullYear()).slice(2); }
function nowHHMM(){ var d=new Date();
  return String(d.getHours()).padStart(2,'0')+String(d.getMinutes()).padStart(2,'0'); }
function fmtDate(iso){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(iso||'')) return iso||'';
  var p = iso.split('-'), d = new Date(+p[0], +p[1]-1, +p[2]);
  var days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return days[d.getDay()]+' '+(+p[1])+'/'+(+p[2])+'/'+p[0];
}
var SECTIONS = ['home','office','block','search','sched','form','hist','yard','yardsheet','log','settings'];
var SECTION_TITLES = { home:'', office:'', block:'Trailer block', search:'Search', sched:'Schedule',
  form:'Seal Form', hist:'Saved', yard:'Yard Check', yardsheet:'Yard Check',
  log:'Log', settings:'Settings' };
/* Navigation runs on real browser history, so the platform's own back works:
   one finger from the left edge on iOS/iPadOS and Android, two fingers on a Mac
   trackpad, and the browser back button on a laptop. */
/* Which screens a role may reach. The UI hides the rest, but the real
   enforcement is in the Firestore rules, not here. */
var OFFICE_ONLY  = ['office','block'];
var OFFICER_ONLY = ['yard','yardsheet','log','form','hist','search'];
function isOffice(){ return (window.CLOUD && CLOUD.role) === 'office'; }
function homeSection(){ return isOffice() ? 'office' : 'home'; }
function applyRole(){
  var off = isOffice();
  document.body.classList.toggle('role-office', off);
  var cur = (history.state && history.state.sec) || 'home';
  var shown = document.querySelector('section.on');
  var shownId = shown ? shown.id.replace('sec-','') : 'home';
  var blocked = off ? OFFICER_ONLY.indexOf(cur)>=0 : OFFICE_ONLY.indexOf(cur)>=0;
  if(cur==='home' && off) blocked = true;
  if(cur==='office' && !off) blocked = true;
  /* the visible screen can lag the recorded one on a deep link */
  if(!blocked && shownId !== cur) { go(cur, true); return; }
  if(blocked) go(homeSection());
}
function go(name, fromHistory){
  if(SECTIONS.indexOf(name)<0) name = homeSection();
  if(name==='home' && isOffice()) name='office';
  if(name==='office' && !isOffice()) name='home';
  /* a role never lands on the other role's screens */
  if(isOffice() && OFFICER_ONLY.indexOf(name)>=0 && name!=='sched') name='office';
  if(!isOffice() && OFFICE_ONLY.indexOf(name)>=0) name='home';
  if(!fromHistory){
    try{
      var cur = (history.state && history.state.sec) || null;
      if(cur !== name){
        if(cur===null && name==='home') history.replaceState({sec:name}, '', '#home');
        else history.pushState({sec:name}, '', '#'+name);
      }
    }catch(e){}
  }
  SECTIONS.forEach(function(n){
    var sec=$('sec-'+n); if(sec) sec.classList.toggle('on', n===name);
  });
  $('hdrtitle').textContent = (name==='home') ? '' : (SECTION_TITLES[name] || '');
  menuFill();
  if(name==='sched') renderSched();
  if(name==='office'){ officeStat(); }
  if(name==='block'){ blockRender(); }
  if(name==='hist') renderHist();
  if(name==='log') renderLog();
  if(name==='form') sigInit();
  if(name==='settings'){ var i=$('set_offname'); if(i) i.value=getOfficerName(); }
  if(name!=='yardsheet' && typeof ycExitView==='function') ycExitView();
  if(name==='yard'){ renderYardSlots(); renderYardHist(); ycStartTicking(); }
  else if(typeof ycStopTicking==='function' && name!=='yardsheet') ycStopTicking();
  if(name==='yardsheet'){ renderYard(); }
  if(name==='search'){ var q=$('q'); if(q) setTimeout(function(){ q.focus(); },60); }
  window.scrollTo(0,0);
}
/* ---- slide-in menu ---- */

function menuFill(){
  var em=(window.CLOUD&&CLOUD.user&&CLOUD.user.email)||'';
  var nm=getOfficerName() || em.split('@')[0] || 'Officer';
  var d3=$('d_loc');   if(d3) d3.textContent = getLocation();
  var h=$('hdrname');  if(h)  h.textContent  = nm;
  var hm=$('hdrmail'); if(hm) hm.textContent = em;
}
function openMenu(){
  var d=$('drawer'); if(!d) return;
  menuFill();
  d.hidden=false;
  $('menubtn').setAttribute('aria-expanded','true');
  var first=d.querySelector('.ditem'); if(first) first.focus();
}
function closeMenu(){
  var d=$('drawer'); if(!d || d.hidden) return;
  d.hidden=true;
  $('menubtn').setAttribute('aria-expanded','false');
  /* Safari does not focus a button on click, so returning to "whatever was
     focused" lands on <body>. Return to the control that opened the menu. */
  var b=$('menubtn'); if(b && b.focus) b.focus();
}
function menuGo(name){ closeMenu(); go(name); }
window.addEventListener('popstate', function(e){
  /* an open menu swallows the first back, which is what a drawer should do */
  var d=$('drawer');
  if(d && !d.hidden){ closeMenu(); }
  go((e.state && e.state.sec) || 'home', true);
});
(function(){
  try{
    var h=(location.hash||'').replace('#','');
    var start = SECTIONS.indexOf(h)>=0 ? h : 'home';
    history.replaceState({sec:start}, '', '#'+start);
    /* a deep link has to actually show that screen, not just record it.
       applyRole() corrects it once the account's role arrives. */
    if(start !== 'home') go(start, true);
  }catch(e){}
})();
document.addEventListener('keydown', function(e){
  if(e.key==='Escape') closeMenu();
});

function toggle(id){ var e=$(id); e.style.display = e.style.display==='none'?'block':'none'; }
function stat(){
  var dates = {}; DB.orders.forEach(function(o){ dates[o.date]=1; });
  var ds = Object.keys(dates).sort();
  $('datastat').textContent = DB.orders.length
    ? DB.orders.length+' orders loaded • '+ds.map(function(d){return fmtDate(d).replace(/ \d{4}$/,'');}).join('  |  ')
    : 'No schedule loaded yet. Go to the Schedule tab.';
}

/* ======================= import ======================= */
function normalizeRow(o){
  return {
    date:String(o.date||'').trim(), zone:String(o.zone||'').trim(),
    priority:String(o.priority||'').trim(), detail:String(o.detail||'').trim(),
    time:String(o.time||'').trim(), in_yard:String(o.in_yard||o.inyard||'').trim(),
    order:String(o.order||o.order_number||'').trim(),
    vendor:String(o.vendor||o.vendor_name||'').trim(),
    carrier:String(o.carrier||'').trim(), contact:String(o.contact||'').trim(),
    cases:+o.cases||0, pallets:+o.pallets||0
  };
}
function parseCSV(text){
  /* copying rows out of Excel gives tabs, not commas, so pick whichever the
     first line actually uses */
  var firstLine = String(text).split(/\r?\n/)[0] || '';
  var DELIM = (firstLine.split('\t').length > firstLine.split(',').length) ? '\t' : ',';
  var rows=[],row=[],cur='',inQ=false;
  for(var i=0;i<text.length;i++){
    var ch=text[i];
    if(inQ){ if(ch==='"'){ if(text[i+1]==='"'){cur+='"';i++;} else inQ=false; } else cur+=ch; }
    else if(ch==='"') inQ=true;
    else if(ch===DELIM){ row.push(cur); cur=''; }
    else if(ch==='\n'||ch==='\r'){ if(cur!==''||row.length){row.push(cur);rows.push(row);row=[];cur='';} }
    else cur+=ch;
  }
  if(cur!==''||row.length){row.push(cur);rows.push(row);}
  if(!rows.length) return [];
  var ALIAS = { order_number:'order', 'order_#':'order', vendor:'vendor', vendor_name:'vendor',
    appointment_carrier:'carrier', carrier:'carrier', contact_name:'contact',
    open_cases:'cases', cases:'cases', pallets:'pallets', zones:'zone', zone:'zone',
    in_yard:'in_yard', 'in_yard?':'in_yard', detail:'detail', time:'time', date:'date',
    'priority_(*)':'priority', 'priority_(\u2605)':'priority', priority:'priority' };
  var hdr = rows[0].map(function(h){
    var k = h.trim().toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_#?()*\u2605]/g,'');
    return ALIAS[k] || k;
  });
  return rows.slice(1).map(function(r){
    var o={}; hdr.forEach(function(h,i){o[h]=r[i];}); return o; });
}
function mergeOrders(arr){
  var add=0, upd=0;
  arr.map(normalizeRow).forEach(function(n){
    if(!n.order) return;
    var i = DB.orders.findIndex(function(o){ return o.order===n.order && o.date===n.date; });
    if(i>=0){ DB.orders[i]=n; upd++; } else { DB.orders.push(n); add++; }
  });
  DB.orders.sort(function(a,b){ return a.date<b.date?-1:a.date>b.date?1:(a.zone<b.zone?-1:1); });
  persist(); stat(); renderSched();
  toast('Imported: '+add+' new, '+upd+' updated');
}
function ingest(text){
  text = text.trim(); if(!text){ toast('Nothing to import'); return; }
  var arr = [];
  try{
    if(text[0]==='{'||text[0]==='['){
      var j = JSON.parse(text);
      arr = Array.isArray(j) ? j : (j.orders||[]);
    } else arr = parseCSV(text);
  }catch(e){ toast('Could not read file: '+e.message); return; }
  receiveOrders(arr);
}
/* The office checks and edits the schedule before anything reaches the yard. */
function receiveOrders(arr){
  if(typeof isOffice==='function' && isOffice()) stageOrders(arr);
  else mergeOrders(arr);
}
$('file').addEventListener('change', function(){
  var f=this.files[0]; if(!f) return;
  var name = (f.name||'').toLowerCase();
  if(/\.(xlsx|xlsm)$/.test(name)){
    var r1=new FileReader();
    r1.onload=function(){ try{ importXlsx(r1.result); }catch(e){ toast('Could not read spreadsheet: '+e.message); } };
    r1.readAsArrayBuffer(f);
  } else {
    var r=new FileReader();
    r.onload=function(){ ingest(String(r.result)); };
    r.readAsText(f);
  }
  this.value='';
});
function importPaste(){ ingest($('paste').value); $('paste').value=''; }
function clearAll(){
  if(!confirm('Delete ALL loaded schedule data? Saved forms are kept.')) return;
  DB.orders=[]; persist(); stat(); renderSched(); toast('Schedule cleared');
}

/* ---- schedule staging: upload, correct, preview, submit ---- */
var SCHED_DRAFT = null;
var DG_COLS = [
  {k:'date',     t:'Date',     w:96},
  {k:'zone',     t:'Zone',     w:56},
  {k:'priority', t:'Priority', w:64},
  {k:'detail',   t:'Detail',   w:70},
  {k:'time',     t:'Time',     w:64},
  {k:'in_yard',  t:'In Yard',  w:64},
  {k:'order',    t:'Order Number', w:110},
  {k:'vendor',   t:'Vendor Name',  w:230},
  {k:'carrier',  t:'Appointment Carrier', w:170},
  {k:'contact',  t:'Contact Name', w:130},
  {k:'cases',    t:'Open Cases', w:88},
  {k:'pallets',  t:'Pallets',   w:70}
];
function stageOrders(arr){
  var rows = (arr||[]).map(normalizeRow).filter(function(n){ return n.order; });
  if(!rows.length){ toast('Nothing to load'); return; }
  rows.sort(function(a,b){ return a.date<b.date?-1:a.date>b.date?1:(a.order<b.order?-1:1); });
  SCHED_DRAFT = rows;
  schedRenderDraft();
  toast('Loaded '+rows.length+' rows. Check them, then preview.');
}
function schedSet(i,k,v){
  if(!SCHED_DRAFT || !SCHED_DRAFT[i]) return;
  SCHED_DRAFT[i][k] = (k==='cases'||k==='pallets') ? (parseInt(v,10)||0) : v;
  schedInvalidate();
}
function schedDel(i){
  if(!SCHED_DRAFT) return;
  SCHED_DRAFT.splice(i,1);
  schedRenderDraft();
}
function schedInvalidate(){
  var a=$('schedactions'); if(a) a.hidden = true;
  var p=$('schedpreview'); if(p) p.innerHTML='';
}
function schedRenderDraft(){
  var card=$('draftcard'); if(!card) return;
  if(!SCHED_DRAFT || !SCHED_DRAFT.length){ card.hidden = true; return; }
  card.hidden = false;
  $('draftcnt').textContent = '('+SCHED_DRAFT.length+')';
  var head = '<tr>' + DG_COLS.map(function(c){
    return '<th style="min-width:'+c.w+'px">'+esc(c.t)+'</th>'; }).join('') + '<th></th></tr>';
  var body = SCHED_DRAFT.map(function(r,i){
    return '<tr>' + DG_COLS.map(function(c){
      return '<td><input value="'+esc(r[c.k]==null?'':String(r[c.k]))+'"'
        + ' oninput="schedSet('+i+',\''+c.k+'\',this.value)"></td>';
    }).join('') + '<td><button class="dgdel" onclick="schedDel('+i+')">\u2715</button></td></tr>';
  }).join('');
  $('draftgrid').innerHTML = '<div class="dgwrap"><table class="dg">'+head+body+'</table></div>';
  schedInvalidate();
}
function schedDiscard(){
  if(!confirm('Discard this schedule without submitting it?')) return;
  SCHED_DRAFT = null; schedRenderDraft();
  var c=$('draftcard'); if(c) c.hidden = true;
  toast('Discarded');
}
/* the preview is the sheet exactly as it prints */
function schedPreview(){
  if(!SCHED_DRAFT || !SCHED_DRAFT.length){ toast('Nothing to preview'); return; }
  var bydate = {};
  SCHED_DRAFT.forEach(function(r){ (bydate[r.date] = bydate[r.date] || []).push(r); });
  var html = Object.keys(bydate).sort().map(function(d){
    var rows = bydate[d].slice().sort(function(a,b){
      return (a.zone||'')<(b.zone||'')?-1:(a.zone||'')>(b.zone||'')?1:((a.time||'')<(b.time||'')?-1:1); });
    var cases=0, pallets=0;
    rows.forEach(function(r){ cases+=(+r.cases||0); pallets+=(+r.pallets||0); });
    return '<div class="prnhead">'
      + '<div class="prnconf">MARTIN BROWER, Inc. Confidential</div>'
      + '<div class="prndate">'+esc(fmtLongDate(d))+'</div></div>'
      + '<div class="prnwrap"><table class="prn"><tr>'
      + '<th></th><th>Zones</th><th>Detail</th><th>Time</th><th>In Yard</th>'
      + '<th>Order Number</th><th>Vendor Name</th><th>Appointment Carrier</th>'
      + '<th>Contact Name</th><th class="num">Open Cases</th><th class="num">Pallets</th></tr>'
      + rows.map(function(r){
          return '<tr><td>'+(r.priority?'\u2605':'')+'</td>'
            + '<td>'+esc(r.zone)+'</td><td>'+esc(r.detail)+'</td><td>'+esc(r.time)+'</td>'
            + '<td>'+esc(r.in_yard)+'</td><td>'+esc(r.order)+'</td>'
            + '<td>'+esc(r.vendor)+'</td><td>'+esc(r.carrier)+'</td><td>'+esc(r.contact)+'</td>'
            + '<td class="num">'+(+r.cases||0).toLocaleString()+'</td>'
            + '<td class="num">'+(+r.pallets||0)+'</td></tr>';
        }).join('')
      + '<tr class="tot"><td colspan="9"></td>'
      + '<td class="num">'+cases.toLocaleString()+'</td>'
      + '<td class="num">'+pallets.toLocaleString()+'</td></tr>'
      + '</table></div>';
  }).join('');
  $('schedpreview').innerHTML = html;
  $('schedactions').hidden = false;
  toast('This is how it prints. Submit when it looks right.');
}
function fmtLongDate(iso){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(iso||'')) return iso||'';
  var p=iso.split('-'), d=new Date(+p[0], +p[1]-1, +p[2]);
  var days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var mons=['January','February','March','April','May','June','July',
            'August','September','October','November','December'];
  return days[d.getDay()]+', '+mons[d.getMonth()]+' '+d.getDate()+', '+d.getFullYear();
}
function schedSubmit(){
  if(!SCHED_DRAFT || !SCHED_DRAFT.length){ toast('Nothing to submit'); return; }
  var n = SCHED_DRAFT.length;
  mergeOrders(SCHED_DRAFT);
  SCHED_DRAFT = null;
  var c=$('draftcard'); if(c) c.hidden = true;
  schedInvalidate();
  toast('Submitted '+n+' orders to the yard');
}

/* ======================= search ======================= */
function orderCardHTML(o, withBtn){
  var pills = '<span class="pill zone">Zone '+esc(o.zone)+'</span>'
    + '<span class="pill '+(o.detail==='LIVE'?'live':'drop')+'">'+esc(o.detail)+'</span>'
    + (o.priority?'<span class="pill star">★ priority</span>':'');
  return '<div class="card ordercard">'
    + '<div style="display:flex;justify-content:space-between;align-items:baseline">'
    + '<div style="font-size:21px;font-weight:800">'+esc(o.order)+'</div>'
    + '<div style="font-weight:700;color:var(--blue)">'+esc(fmtDate(o.date))+'</div></div>'
    + '<div style="margin:6px 0 8px">'+pills+'</div>'
    + '<div class="kv"><span class="k">Vendor</span><span class="v">'+esc(o.vendor)+'</span></div>'
    + '<div class="kv"><span class="k">Appt Time</span><span class="v">'+esc(o.time)+'</span></div>'
    + '<div class="kv"><span class="k">Carrier</span><span class="v">'+esc(o.carrier||'N/A')+'</span></div>'
    + '<div class="kv"><span class="k">Contact</span><span class="v">'+esc(o.contact||'N/A')+'</span></div>'
    + '<div class="kv"><span class="k">Open Cases</span><span class="v">'+o.cases.toLocaleString()+'</span></div>'
    + '<div class="kv"><span class="k">Pallets</span><span class="v">'+o.pallets+'</span></div>'
    + '<div class="kv"><span class="k">In Yard</span><span class="v">'+esc(o.in_yard||'N/A')+'</span></div>'
    + (withBtn?'<button class="btn" onclick="fillFromOrder(\''+esc(o.order)+'\',\''+esc(o.date)+'\')">📝 Fill Seal Verification Form</button>':'')
    + '</div>';
}
$('q').addEventListener('input', doSearch);
function doSearch(){
  var q = $('q').value.trim().toUpperCase();
  var out = $('results');
  if(q.length<3){ out.innerHTML = DB.orders.length? '<div class="empty">Waiting for an order number…</div>'
      :'<div class="empty">No schedule loaded yet.<br>Go to the <b>Schedule</b> tab and import today\'s file.</div>';
    return; }
  var hits = DB.orders.filter(function(o){
    return o.order.indexOf(q)>=0 || o.vendor.toUpperCase().indexOf(q)>=0
        || (o.carrier||'').toUpperCase().indexOf(q)>=0;
  }).slice(0,12);
  out.innerHTML = hits.length ? hits.map(function(o){return orderCardHTML(o,true);}).join('')
    : '<div class="empty">❌ No match for “'+esc(q)+'”.<br>Check the number, or the sheet may not be imported yet.</div>';
}

/* ======================= schedule list ======================= */
function renderSched(){
  $('cnt').textContent = DB.orders.length? '('+DB.orders.length+')':'';
  if(!DB.orders.length){ $('sched').innerHTML='<div class="empty">Nothing loaded.</div>'; return; }
  var bydate={};
  DB.orders.forEach(function(o){ (bydate[o.date]=bydate[o.date]||[]).push(o); });
  $('sched').innerHTML = Object.keys(bydate).sort().map(function(d){
    var rows = bydate[d].map(function(o){
      return '<div class="schedrow"><span><b>'+esc(o.order)+'</b> · '+esc(o.zone)+' · '+esc(o.detail)
        +' '+esc(o.time)+'</span><span style="color:var(--mut)">'+esc(o.vendor.slice(0,22))+'</span></div>';
    }).join('');
    return '<div class="schedday">'+fmtDate(d)+' · '+bydate[d].length+' orders</div>'+rows;
  }).join('');
}

/* ======================= form state ======================= */
var CH = { sealtype:null, sealcond:null, fuel:null };
var CHOICES = {
  sealtype:['BOLT','METAL','PLASTIC','CABLE'],
  sealcond:['INTACT','MISSING','BROKEN','LTL (No Seal)'],
  fuel:['FULL','3/4','1/2','1/4','N/A']
};
function buildChoices(){
  Object.keys(CHOICES).forEach(function(k){
    $('c_'+k).innerHTML = CHOICES[k].map(function(v){
      return '<button type="button" onclick="pick(\''+k+'\',\''+v.replace(/'/g,"\\'")+'\',this)">'+v+'</button>';
    }).join('');
  });
}
function pick(k,v,btn){
  if(window.invalidatePreview) invalidatePreview();
  CH[k] = (CH[k]===v)? null : v;
  var btns = $('c_'+k).querySelectorAll('button');
  btns.forEach(function(b){ b.classList.toggle('sel', b===btn && CH[k]!==null); });
}
function setPick(k,v){
  CH[k]=v||null;
  $('c_'+k).querySelectorAll('button').forEach(function(b){
    b.classList.toggle('sel', b.textContent===v);
  });
}
function fillFromOrder(order,date){
  var o = DB.orders.find(function(x){ return x.order===order && x.date===date; });
  if(!o) return;
  resetForm(false);
  $('f_po').value = o.order;
  var _d=new Date(), _iso=_d.getFullYear()+'-'+String(_d.getMonth()+1).padStart(2,'0')+'-'+String(_d.getDate()).padStart(2,'0');
  var _tag='';
  if(o.date && o.date!==_iso && /^\d{4}-\d{2}-\d{2}$/.test(o.date)){
    var _p=o.date.split('-'); _tag='('+_p[1]+'/'+_p[2]+'/'+_p[0].slice(2)+')';
  }
  $('f_appt').value = (o.time==='???'? '':o.time)+_tag;
  $('f_carrier').value = o.carrier||'';
  $('f_vendor').value = o.vendor||'';
  $('f_datein').value = todayStr();
  $('f_timein').value = nowHHMM();
  $('formsrc').innerHTML = 'Auto-filled from order <b>'+esc(o.order)+'</b> · '+esc(o.vendor)
    +' ('+esc(fmtDate(o.date))+', '+esc(o.detail)+' '+esc(o.time)+')';
  go('form'); toast('Form filled from order '+o.order);
  formDraftSave();
}
function resetForm(msg){
  ['f_datein','f_timein','f_appt','f_po','f_trailer','f_tractor','f_carrier','f_vendor','f_initials',
   'f_driver','f_sealtrailer','f_sealbol','f_reefset','f_reefact','f_verified']
   .forEach(function(id){ $(id).value=''; });
  $('f_photoid').checked=false; $('f_locked').checked=false;
  setPick('sealtype',null); setPick('sealcond',null); setPick('fuel',null);
  clearSig();
  $('f_datein').value = todayStr(); $('f_timein').value = nowHHMM();
  var pm=$('f_pomode'); if(pm){ pm.value='po'; $('f_po').disabled=false; }
  $('f_verified').value = getOfficerName();
  var ac=$('actions'); if(ac) ac.style.display='none';
  $('formsrc').textContent = '';
  $('preview').innerHTML='';
  Object.keys(REQ_FIELDS||{}).forEach(function(id){ var e=$(id); if(e) e.classList.remove('miss'); });
  var sw=$('sealwarn'); if(sw){ sw.classList.remove('on'); sw.textContent=''; }
  if(msg){ formDraftClear(); toast('New blank form'); }
}

/* ---- seal verification: the two numbers must agree ---- */
function sealNorm(v){ return String(v||'').trim().toUpperCase().replace(/\s+/g,''); }
function sealMismatch(d){
  var a=sealNorm((d||collect()).sealtrailer), b=sealNorm((d||collect()).sealbol);
  return !!(a && b && a!==b);
}
function checkSeal(){
  var w=$('sealwarn'); if(!w) return;
  var on=sealMismatch(null);
  w.classList.toggle('on', on);
  w.textContent = on
    ? 'Seal numbers do not match. The number on the trailer is not the number on the BOL \u2014 report this before the driver leaves.'
    : '';
}

/* ---- required fields, marked as the officer goes ---- */
var REQ_FIELDS = {
  f_appt:'Appt Time', f_po:'PO Number', f_trailer:'Trailer Number', f_tractor:'Tractor Number',
  f_carrier:'Carrier Name', f_initials:'Initials', f_driver:'Driver Name',
  f_reefset:'Refer Setting', f_reefact:'Refer Actual',
  f_sealtrailer:'Seal Number on Trailer', f_sealbol:'Seal Number on BOL', f_verified:'Verified by'
};
function markMissing(id){
  var el=$(id); if(!el) return;
  var skipPo = (id==='f_po') && $('f_pomode') && $('f_pomode').value==='na';
  el.classList.toggle('miss', !skipPo && !String(el.value||'').trim());
}
function markAllMissing(){ Object.keys(REQ_FIELDS).forEach(markMissing); }
(function(){
  Object.keys(REQ_FIELDS).forEach(function(id){
    var el=$(id); if(!el) return;
    el.addEventListener('blur', function(){ markMissing(id); });
    el.addEventListener('input', function(){ if(el.classList.contains('miss')) markMissing(id); });
  });
})();

/* ---- draft: a gate officer gets interrupted, the form must survive it ---- */
var FORM_FIELDS = ['f_datein','f_timein','f_appt','f_po','f_trailer','f_tractor','f_carrier',
  'f_vendor','f_initials','f_driver','f_sealtrailer','f_sealbol','f_reefset','f_reefact','f_verified'];
var _draftT=null;
function formDraftSave(){
  clearTimeout(_draftT);
  _draftT=setTimeout(function(){
    try{
      var d={ v:{},
        photoid:$('f_photoid').checked, locked:$('f_locked').checked,
        pick:{sealtype:CH.sealtype, sealcond:CH.sealcond, fuel:CH.fuel},
        pomode:($('f_pomode')||{}).value||'po',
        src:$('formsrc').innerHTML,
        sig:(sigHas && sigCv)? sigCv.toDataURL('image/png') : '' };
      FORM_FIELDS.forEach(function(id){ if($(id)) d.v[id]=$(id).value; });
      sset('gc_formdraft', JSON.stringify(d));
    }catch(e){}
  }, 400);
}
function formDraftClear(){ clearTimeout(_draftT); try{ sset('gc_formdraft',''); }catch(e){} }
function formDraftRestore(){
  var raw=null; try{ raw=sget('gc_formdraft'); }catch(e){}
  if(!raw) return false;
  var d=null; try{ d=JSON.parse(raw); }catch(e){}
  if(!d || !d.v) return false;
  var typed = FORM_FIELDS.some(function(id){
    return ['f_datein','f_timein','f_verified'].indexOf(id)<0 && String(d.v[id]||'').trim();
  });
  if(!typed && !d.sig) return false;               // nothing worth restoring
  FORM_FIELDS.forEach(function(id){ if($(id) && d.v[id]!=null) $(id).value=d.v[id]; });
  $('f_photoid').checked=!!d.photoid; $('f_locked').checked=!!d.locked;
  if(d.pick){ setPick('sealtype',d.pick.sealtype); setPick('sealcond',d.pick.sealcond); setPick('fuel',d.pick.fuel); }
  var pm=$('f_pomode'); if(pm && d.pomode){ pm.value=d.pomode; if(typeof poMode==='function') poMode(); }
  if(d.src) $('formsrc').innerHTML=d.src;
  if(d.sig){
    var im=new Image();
    im.onload=function(){ sigInit(); if(sigCx){ sigCx.drawImage(im,0,0,$('sig').clientWidth,$('sig').clientHeight); sigHas=true; } };
    im.src=d.sig;
  }
  checkSeal();
  toast('Unfinished form restored');
  return true;
}
function stampTimeIn(){ $('f_timein').value = nowHHMM(); formDraftSave(); invalidatePreview(); }

/* ======================= signature pad ======================= */
var sigCv, sigCx, sigHas=false, sigReady=false;
function sigInit(){
  sigCv = $('sig');
  var w = sigCv.clientWidth, h = sigCv.clientHeight;
  if(!w) return;
  if(!sigReady || sigCv.width!==Math.round(w*2)){
    var old = sigHas? sigCv.toDataURL():null;
    sigCv.width=Math.round(w*2); sigCv.height=Math.round(h*2);
    sigCx = sigCv.getContext('2d');
    sigCx.scale(2,2); sigCx.lineWidth=2.4; sigCx.lineCap='round'; sigCx.lineJoin='round';
    sigCx.strokeStyle='#101820';
    sigReady=true;
    if(old){ var im=new Image(); im.onload=function(){ sigCx.drawImage(im,0,0,w,h); }; im.src=old; }
  }
}
function sigPos(e){
  var r = sigCv.getBoundingClientRect();
  var p = e.touches? e.touches[0]: e;
  return {x:p.clientX-r.left, y:p.clientY-r.top};
}
var drawing=false;
function sigDown(e){ e.preventDefault(); if(window.invalidatePreview) invalidatePreview(); sigInit(); drawing=true; var p=sigPos(e);
  sigCx.beginPath(); sigCx.moveTo(p.x,p.y); sigCx.lineTo(p.x+.1,p.y+.1); sigCx.stroke(); sigHas=true; }
function sigMove(e){ if(!drawing) return; e.preventDefault(); var p=sigPos(e);
  sigCx.lineTo(p.x,p.y); sigCx.stroke(); }
function sigUp(){ drawing=false; }
function clearSig(){ if(sigCx){ sigCx.save(); sigCx.setTransform(1,0,0,1,0,0);
  sigCx.clearRect(0,0,sigCv.width,sigCv.height); sigCx.restore(); } sigHas=false; }
window.addEventListener('load', function(){
  sigInit();
  var c=$('sig');
  c.addEventListener('pointerdown',sigDown); c.addEventListener('pointermove',sigMove);
  window.addEventListener('pointerup',sigUp);
  c.addEventListener('touchstart',sigDown,{passive:false});
  c.addEventListener('touchmove',sigMove,{passive:false});
  window.addEventListener('touchend',sigUp);
});

/* ======================= collect + render paper form ======================= */
function collect(){
  return {
    ts:new Date().toISOString(),
    datein:$('f_datein').value, timein:$('f_timein').value, appt:$('f_appt').value,
    po:$('f_po').value, trailer:$('f_trailer').value, carrier:$('f_carrier').value,
    tractor:$('f_tractor').value,
    vendor:$('f_vendor').value, initials:$('f_initials').value.toUpperCase(),
    driver:$('f_driver').value, photoid:$('f_photoid').checked,
    sealtype:CH.sealtype, sealtrailer:$('f_sealtrailer').value, sealbol:$('f_sealbol').value,
    sealcond:CH.sealcond, locked:$('f_locked').checked,
    reefset:$('f_reefset').value, reefact:$('f_reefact').value,
    fuel:CH.fuel, verified:$('f_verified').value,
    sig:(sigHas && sigCv)? sigCv.toDataURL('image/png'):null
  };
}
function drawPaper(d, done){
  var cv=$('paper'), g=cv.getContext('2d');
  g.setTransform(1,0,0,1,0,0);
  g.fillStyle='#fff'; g.fillRect(0,0,1275,1650);
  g.fillStyle='#111'; g.textBaseline='alphabetic';
  var L=95, R=1180;
  function txt(t,x,y,size,bold,italic,center){
    g.font=(italic?'italic ':'')+(bold?'bold ':'')+size+'px Arial';
    g.textAlign=center?'center':'left'; g.fillText(t,x,y); g.textAlign='left';
  }
  function line(x1,x2,y){ g.strokeStyle='#333'; g.lineWidth=1.6;
    g.beginPath(); g.moveTo(x1,y); g.lineTo(x2,y); g.stroke(); }
  function field(label,lx,y,vx1,vx2,val,vsize){
    txt(label,lx,y,26,true); line(vx1,vx2,y+6);
    if(val) txt(val,vx1+12,y-2,vsize||26,false);
  }
  function box(x,y,s,checked){ g.strokeStyle='#333'; g.lineWidth=2; g.strokeRect(x,y,s,s);
    if(checked){ g.strokeStyle='#0A3E9C'; g.lineWidth=4; g.beginPath();
      g.moveTo(x+5,y+s*0.55); g.lineTo(x+s*0.4,y+s-6); g.lineTo(x+s-4,y+4); g.stroke(); } }
  function options(y, list, chosen, startX, gap, size){
    var x=startX;
    list.forEach(function(op){
      g.font='bold '+size+'px Arial';
      var w=g.measureText(op).width;
      txt(op,x,y,size,true);
      if(chosen===op){ g.strokeStyle='#0A3E9C'; g.lineWidth=3.5;
        g.beginPath(); g.ellipse(x+w/2,y-9,w/2+16,24,0,0,Math.PI*2); g.stroke(); }
      x+=w+gap;
    });
  }
  // Title + banner
  txt('Seal Verification Form',637,78,42,true,false,true);
  g.fillStyle='#C9C9C9'; g.fillRect(L,100,R-L,40);
  g.fillStyle='#222';
  txt('***DRIVER MUST SLIDE TANDEMS BACK***',637,128,26,true,false,true);
  g.fillStyle='#111';
  // Initials
  field('Initials',330,190,430,560,d.initials,28);
  // Date/Time/Appt
  field('Date In:',L,250,205,320,d.datein);
  field('Time In:',350,250,455,560,d.timein);
  field('Appt Time:',590,250,730,R,d.appt);
  // PO / Trailer
  field('PO Number:',L,315,250,470,d.po,30);
  field('Trailer Number:',505,315,700,R,d.trailer,30);
  // Carrier
  field('Carrier Name:',L,380,275,R,d.carrier);
  // Driver name
  field('Driver Name (Print):',L,448,355,R,d.driver);
  // Signature
  txt('Driver Signature:',L,530,26,true);
  line(320,R,536);
  if(d.sig){ var im=new Image(); im.onload=function(){
      /* crop to the ink, then fit inside a fixed box so it can never overlap other fields */
      var tc=document.createElement('canvas'); tc.width=im.width; tc.height=im.height;
      var tg=tc.getContext('2d'); tg.drawImage(im,0,0);
      var px=tg.getImageData(0,0,tc.width,tc.height).data;
      var minX=tc.width,minY=tc.height,maxX=-1,maxY=-1;
      for(var yy=0;yy<tc.height;yy++)for(var xx=0;xx<tc.width;xx++){
        if(px[(yy*tc.width+xx)*4+3]>10){ if(xx<minX)minX=xx; if(xx>maxX)maxX=xx;
          if(yy<minY)minY=yy; if(yy>maxY)maxY=yy; } }
      if(maxX>=minX){
        var sw=maxX-minX+1, sh=maxY-minY+1;
        var boxX=340, boxW=560, boxH=72, boxBottom=532;
        var sc=Math.min(boxW/sw, boxH/sh);
        var dw=sw*sc, dh=sh*sc;
        g.drawImage(tc,minX,minY,sw,sh, boxX, boxBottom-dh, dw, dh);
      }
      after(); };
    im.onerror=after; im.src=d.sig; }
  function after(){
    txt('The above load has been in my control and has not been tampered with during transit.',637,572,23,false,true,true);
    // photo id
    box(L,600,34,d.photoid);
    txt("Driver's Photo ID has been checked",L+50,626,26,false);
    // Seal type
    txt('Seal Type:',L,700,26,true);
    options(700,['BOLT','METAL','PLASTIC','CABLE'],d.sealtype,420,70,26);
    txt('(Circle One)',637,738,22,false,true,true);
    // Seal numbers
    field('Seal Number on Trailer:',L,800,400,R,d.sealtrailer,30);
    field('Seal Number on BOL:',L,862,400,R,d.sealbol,30);
    if(sealMismatch(d)){
      g.fillStyle='#C0392B';
      txt('*** SEAL NUMBERS DO NOT MATCH ***',637,912,26,true,false,true);
      g.fillStyle='#111';
    }
    // Condition
    txt('Seal Condition:',L,930,26,true);
    options(930,['INTACT','MISSING','BROKEN','LTL (No Seal)'],d.sealcond,380,58,26);
    txt('(Circle One)',637,968,22,false,true,true);
    // locked
    box(L,995,34,d.locked);
    txt('Trailer was locked upon arrival (LTL loads only!)',L+50,1021,26,false);
    // Refer
    field('Refer Setting:',L,1090,290,470,d.reefset);
    field('Refer Actual:',505,1090,690,R,d.reefact);
    // Fuel
    txt('Fuel Level:',L,1160,26,true);
    options(1160,['FULL','3/4','1/2','1/4','N/A'],d.fuel,300,64,26);
    txt('(Dry loads ONLY!)',830,1160,24,false,true);
    txt('(Circle One)',420,1198,22,false,true,true);
    // Verified
    field('Verified by:',L,1265,250,R,d.verified);
    // Footer reference
    g.fillStyle='#666';
    txt('Vendor: '+(d.vendor||'N/A')+'    ·    Generated by Checkpoint '
        +new Date(d.ts).toLocaleString(),637,1600,20,false,true,true);
    g.fillStyle='#111';
    done(cv);
  }
  if(!d.sig) after();
}
function fileName(d){
  var po=String(d.po||'unknown').replace(/[^A-Za-z0-9]/g,'')||'NA';
  return 'SealForm_PO'+po+'_'+(d.datein||'').replace(/\//g,'-')+'.png';
}

/* ======================= actions ======================= */
function previewForm(){
  var m = blankFields();
  markAllMissing();
  checkSeal();
  if(m.length && !confirm('These fields are still empty:\n\n• '+m.join('\n• ')
      +'\n\nOK = continue anyway   ·   Cancel = go back and fill them')) return;
  drawPaper(collect(), function(cv){
    $('preview').innerHTML='<img alt="form preview" src="'+cv.toDataURL('image/png')+'">';
    var a=$('actions'); if(a) a.style.display='block';
    toast('Check the preview, then save / email below'); });
}
function saveForm(){
  var d = collect();
  if(!d.po){ toast('PO / Order number is empty'); return; }
  formDraftClear();
  DB.forms.unshift(d);
  if(DB.forms.length>60) DB.forms.length=60;
  persist(); renderHist();
  toast('Form saved ✔  ('+DB.forms.length+' on file)');
}
function shareData(d){
  drawPaper(d, function(cv){
    cv.toBlob(function(blob){
      var f = new File([blob], fileName(d), {type:'image/png'});
      if(navigator.canShare && navigator.canShare({files:[f]})){
        navigator.share({files:[f],
          title:'Seal Verification – PO '+d.po,
          text:'Seal Verification Form – PO '+d.po+' – '+(d.carrier||'')+' – '+(d.datein||'')})
        .catch(function(){});
      } else {
        var a=document.createElement('a');
        a.href=URL.createObjectURL(blob); a.download=fileName(d); a.click();
        toast('Image downloaded. Attach it to your email.');
      }
    },'image/png');
  });
}
function shareForm(){
  var d=collect();
  if(!d.po){ toast('PO / Order number is empty'); return; }
  shareData(d);
}
function offKey(){ var em=(window.CLOUD&&CLOUD.user&&CLOUD.user.email)||'local'; return 'gc_offname_'+em; }
function getOfficerName(){ return (sget(offKey())||'').trim(); }
function getLocation(){ return (sget('gc_location')||'Martin Brower').trim(); }
(function(){ var i=$('set_location'); if(!i) return;
  i.value=getLocation();
  i.addEventListener('input', function(){ sset('gc_location', i.value.trim()); }); })();
/* Morning shift runs 06:00-18:00, evening 18:00-06:00 */
function currentShift(d){
  var h=(d||new Date()).getHours();
  return (h>=6 && h<18) ? '6am - 6pm' : '6pm - 6am';
}
(function(){ var i=$('set_offname'); if(!i) return;
  i.addEventListener('input', function(){ if(typeof menuFill==='function') menuFill(); });
  i.addEventListener('input', function(){ sset(offKey(), i.value.trim());
    var v=$('f_verified'); if(v) v.value=i.value.trim(); });
  i.addEventListener('change', function(){
    if(window.CLOUD && CLOUD.ready) CLOUD.db.collection('officers').doc(CLOUD.user.email)
      .set({name:i.value.trim()},{merge:true});
  });
})();
function poMode(){
  var m=$('f_pomode').value, p=$('f_po');
  if(m==='na'){ p.value='N/A'; p.disabled=true; }
  else { p.disabled=false; if(p.value==='N/A') p.value=''; }
  invalidatePreview();
}
function invalidatePreview(){ var a=$('actions'); if(a) a.style.display='none'; }
function blankFields(){
  var d=collect(), m=[];
  if(!d.appt) m.push('Appt Time');
  if(!d.po) m.push('PO Number');
  if(!d.trailer) m.push('Trailer Number');
  if(!d.tractor) m.push('Tractor Number');
  if(!d.carrier) m.push('Carrier Name');
  if(!d.initials) m.push('Initials');
  if(!d.driver) m.push('Driver Name');
  if(!d.sig) m.push('Driver Signature');
  if(!d.photoid) m.push("Photo ID checked box");
  if(!d.reefset) m.push('Refer Setting');
  if(!d.reefact) m.push('Refer Actual');
  if(!d.fuel) m.push('Fuel Level');
  if(!d.sealtype) m.push('Seal Type');
  if(!d.sealtrailer) m.push('Seal Number on Trailer');
  if(!d.sealbol) m.push('Seal Number on BOL');
  if(!d.sealcond) m.push('Seal Condition');
  if(!d.verified) m.push('Verified by');
  return m;
}
function getOfficeEmail(){ return (sget('gc_email')||'').trim(); }
function getMailerUrl(){ return (sget('gc_mailer')||'').trim(); }
function autoSend(d){
  toast('📤 Sending to the receiving office…');
  drawPaper(d, function(cv){
    var png = cv.toDataURL('image/png').split(',')[1];
    fetch(getMailerUrl(), {method:'POST', body: JSON.stringify({
      to:getOfficeEmail(), cc:getCcEmails(),
      png:png, filename:fileName(d), po:d.po, carrier:d.carrier, driver:d.driver,
      datein:d.datein, timein:d.timein, sealcond:d.sealcond, sealtype:d.sealtype,
      sealtrailer:d.sealtrailer,
      sentBy:(window.CLOUD && CLOUD.user && CLOUD.user.email)||''
    })})
    .then(function(r){ return r.json(); })
    .then(function(j){
      if(j && j.ok) toast('✅ Sent to the receiving office');
      else toast('⚠️ Send failed'+((j&&j.error)?': '+j.error:'')+'. Use "Share another way".');
    })
    .catch(function(){ toast('⚠️ Could not confirm the send. Check with the office before re-sending, or use "Share another way".'); });
  });
}
(function(){ var m=document.getElementById('set_mailer'); if(!m) return;
  m.addEventListener('input', function(){ sset('gc_mailer', m.value.trim()); }); })();
function emailData(d){
  logAdd(d);
  if(getMailerUrl()){ autoSend(d); return; }
  drawPaper(d, function(cv){
    var blobP = new Promise(function(res){ cv.toBlob(res,'image/png'); });
    function dl(){ blobP.then(function(b){ var a=document.createElement('a');
      a.href=URL.createObjectURL(b); a.download=fileName(d); a.click(); }); }
    function openMail(copied){
      var to=getOfficeEmail().replace(/\s+/g,'');
      var sub=encodeURIComponent('Seal Verification - PO '+d.po+' - '+(d.datein||''));
      var body=encodeURIComponent('Seal Verification Form\n'
        +'PO Number: '+d.po+'\nCarrier: '+(d.carrier||'-')+'\nDriver: '+(d.driver||'-')
        +'\nDate/Time in: '+(d.datein||'')+' '+(d.timein||'')
        +'\nSeal: '+(d.sealcond||'-')+' ('+(d.sealtype||'-')+') #'+(d.sealtrailer||'-')
        +(sealMismatch(d)? '\n*** SEAL NUMBERS DO NOT MATCH: trailer '+(d.sealtrailer||'-')
            +' vs BOL '+(d.sealbol||'-')+' ***':'')+'\n\n'
        +(copied? 'The completed form image is on the clipboard - paste it here (Cmd/Ctrl+V).'
                : 'The completed form image was downloaded - please attach it.'));
      var cc=getCcEmails().replace(/\s+/g,'');
      location.href='mailto:'+to+'?'+(cc?'cc='+encodeURIComponent(cc)+'&':'')+'subject='+sub+'&body='+body;
      toast(copied? '📋 Form image copied. Paste it into the email (Cmd/Ctrl+V).'
                  : '⬇ Form image downloaded. Attach it to the email.');
    }
    if(navigator.clipboard && window.ClipboardItem){
      navigator.clipboard.write([new ClipboardItem({'image/png':blobP})])
        .then(function(){ openMail(true); })
        .catch(function(){ dl(); openMail(false); });
    } else { dl(); openMail(false); }
  });
}
function emailForm(){
  var d=collect();
  if(!d.po){ toast('PO / Order number is empty'); return; }
  if(!getMailerUrl() && !getOfficeEmail()){
    toast('Set the receiving office email first, in Settings (⚙ top-right).');
    go('settings'); return; }
  emailData(d);
}
function emailHist(i){
  if(!getMailerUrl() && !getOfficeEmail()){
    toast('Set the receiving office email first, in Settings (⚙ top-right).'); return; }
  emailData(DB.forms[i]);
}
(function(){ var e=$('set_email'); if(!e) return; e.value=getOfficeEmail();
  e.addEventListener('input', function(){ sset('gc_email', e.value.trim()); }); })();
function getCcEmails(){ return (sget('gc_cc')||'').trim(); }
(function(){ var c=$('set_cc'); if(!c) return; c.value=getCcEmails();
  c.addEventListener('input', function(){ sset('gc_cc', c.value.trim()); }); })();
function renderHist(){
  if(!DB.forms.length){ $('hist').innerHTML='<div class="empty">No saved forms yet.</div>'; return; }
  $('hist').innerHTML = DB.forms.map(function(f,i){
    return '<div class="histitem"><div>'
      +'<div class="t1">PO '+esc(f.po)+' · '+esc(f.driver||'no name')+'</div>'
      +'<div class="t2">'+esc(f.carrier||'')+' · '+esc(f.datein)+' '+esc(f.timein)
      +' · seal '+esc(f.sealcond||'?')+'</div></div>'
      +'<div class="histbtns"><button class="btn" onclick="emailHist('+i+')">📧</button>'
      +'<button class="btn sec" onclick="shareHist('+i+')">📤</button>'
      +'<button class="btn red" onclick="delHist('+i+')">✕</button></div></div>';
  }).join('');
}
function shareHist(i){ shareData(DB.forms[i]); }
function delHist(i){ if(!confirm('Delete this saved form?')) return;
  DB.forms.splice(i,1); persist(); renderHist(); }

/* ======================= NPG gate log ======================= */
/* One row per truck signed into the yard. A row is created when the Seal
   Verification Form is pushed to the receiving office; the officer completes
   Time Out and the trailer the truck leaves with. Plate, State and Notes are
   deliberately left blank, as on the paper log. */
DB.logs = [];
try{ var _lg0 = sget('gc_logs'); if(_lg0) DB.logs = JSON.parse(_lg0); }catch(e){}
function logPersist(){ try{ sset('gc_logs', JSON.stringify(DB.logs.slice(0,400))); }catch(e){} }
function logId(d){ return (d.datein||'')+'_'+(d.po||'')+'_'+(d.timein||''); }
function logAdd(d){
  var id = logId(d);
  if(DB.logs.some(function(r){ return r.id===id; })) return;   // re-sending must not duplicate
  DB.logs.unshift({
    id:id, ts:new Date().toISOString(),
    date:d.datein||todayStr(),
    officer:(window.CLOUD&&CLOUD.user&&CLOUD.user.email)||'', officerName:getOfficerName(),
    po:d.po||'', timein:d.timein||'', trailer:d.trailer||'',
    carrier:d.carrier||'', tractor:d.tractor||'',
    timeout:'', outtrailer:''
  });
  logPersist();
  if(window.logCloudAdd) logCloudAdd(DB.logs[0]);
  if($('sec-log') && $('sec-log').classList.contains('on')) renderLog();
}
function logSet(id,k,v){
  var r = DB.logs.filter(function(x){ return x.id===id; })[0];
  if(!r) return;
  r[k]=v; logPersist();
  if(window.logCloudSet) logCloudSet(r);
}
function logToday(){
  var t=todayStr();
  /* a gate log reads top-down in the order trucks arrived, like the paper form */
  /* order by Time In, which is what the officer reads, falling back to when the
     row was created. Two forms pushed in the same millisecond share a ts, so ts
     alone is not a reliable ordering. */
  function key(r){ return String(r.timein||'').padStart(4,'0') + '|' + (r.ts||''); }
  return DB.logs.filter(function(r){ return r.date===t; })
    .slice().sort(function(a,b){ return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0; });
}
var LOG_MIN_ROWS = 14;
function logCell(v){ return '<td class="logro">'+esc(v||'')+'</td>'; }
function renderLog(){
  var rows = logToday();
  $('log_loc').textContent   = getLocation();
  $('log_shift').textContent = currentShift();
  $('log_guard').textContent = getOfficerName()
    || ((window.CLOUD&&CLOUD.user&&CLOUD.user.email||'').split('@')[0]) || '';
  $('log_date').textContent  = todayStr();
  var head = '<tr>'
    + '<th>Time In</th><th>Time Out</th><th>Out Trailer Number</th><th>Carrier Name</th>'
    + '<th>Tractor Number</th><th>Trailer Number</th><th>Plate Number</th><th>State</th><th>Notes</th>'
    + '</tr>';
  var body = rows.map(function(r){
    var id = esc(r.id);
    return '<tr>'
      + logCell(r.timein)
      + '<td><input value="'+esc(r.timeout)+'" inputmode="numeric"'
      +   ' oninput="logSet(\''+id+'\',\'timeout\',this.value)"></td>'
      + '<td><input value="'+esc(r.outtrailer)+'" style="text-transform:uppercase"'
      +   ' oninput="logSet(\''+id+'\',\'outtrailer\',this.value)"></td>'
      + logCell(r.carrier) + logCell(r.tractor) + logCell(r.trailer)
      + '<td></td><td></td><td></td>'
      + '</tr>';
  }).join('');
  var blanks = Math.max(0, LOG_MIN_ROWS - rows.length);
  for (var i=0; i<blanks; i++) body += '<tr>'+new Array(10).join('<td>&nbsp;</td>')+'</tr>';
  $('logrows').innerHTML = '<div class="ycwrap"><table class="yct logt">'+head+body+'</table></div>';
}

/* ======================= boot ======================= */
buildChoices(); stat(); doSearch(); resetForm(false);
try{ formDraftRestore(); }catch(e){}
(function(){ var s=$('sec-form'); if(!s) return;
  s.addEventListener('input', function(){
    if(window.invalidatePreview) invalidatePreview();
    checkSeal(); formDraftSave();
  }, true);
  s.addEventListener('change', function(){ checkSeal(); formDraftSave(); }, true);
})();

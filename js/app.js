/* Checkpoint · https://gatecheck-martinbrower.netlify.app */

/* ======================= storage (falls back to memory) ======================= */
var MEM = {};
function sget(k){ try{ return localStorage.getItem(k); }catch(e){ return MEM[k]||null; } }
function sset(k,v){ try{ localStorage.setItem(k,v); }catch(e){ MEM[k]=v; } }

/* Two schedules, and only one of them is the truth.

   DB.office  what the receiving office has sent. This is what the yard works
              from, and it is the last word on any day it covers.
   DB.local   a day an officer loaded here from the printed sheet, because the
              office had not sent it yet. It stands in until the office sends
              that day, and then it steps aside.
   DB.orders  what the rest of the app reads: the office copy, plus the local
              copy for days the office has not covered. Derived, never edited. */
var DB = { office: [], local: [], forms: [], notes: [] };
/* DB.orders is what the rest of the app reads, and it is derived. Assigning it
   still means what it always meant - "this is the schedule the office sent" -
   so old code, and a device upgrading from before the split, keep working. */
var _orders = [];
Object.defineProperty(DB, 'orders', {
  get: function(){ return _orders; },
  set: function(v){ DB.office = (v || []).slice(); schedRebuild(); }
});
(function load(){
  try{ var of = sget('gc_office'); if(of) DB.office = JSON.parse(of); }catch(e){}
  try{ var lo = sget('gc_local');  if(lo) DB.local  = JSON.parse(lo); }catch(e){}
  /* a device that was storing one bucket was storing the office's copy */
  if(!sget('gc_office')){
    try{ var o = sget('gc_orders'); if(o) DB.office = JSON.parse(o); }catch(e){}
  }
  try{ var f = sget('gc_forms'); if(f) DB.forms = JSON.parse(f); }catch(e){}
  try{ var n = sget('gc_schednotes'); if(n) DB.notes = JSON.parse(n); }catch(e){}
  schedRebuild();
})();
function persist(){
  sset('gc_office', JSON.stringify(DB.office));
  sset('gc_local',  JSON.stringify(DB.local));
  sset('gc_orders', JSON.stringify(DB.orders));   /* for anything still reading it */
  sset('gc_forms',  JSON.stringify(DB.forms));
  sset('gc_schednotes', JSON.stringify(DB.notes));
}
function schedOfficeDates(){
  var d = {}; DB.office.forEach(function(o){ d[o.date] = 1; }); return d;
}
/* A day the office has sent is the office's day. A local copy of the same day
   is not merged with it, not diffed into it: it is retired. */
function schedRebuild(){
  var have = schedOfficeDates();
  _orders = DB.office.concat(DB.local.filter(function(o){ return !have[o.date]; }));
  _orders.sort(function(a,b){
    return a.date<b.date ? -1 : a.date>b.date ? 1 : schedSeqCmp(a,b); });
}
/* true when this day is only on this device, so the screen can say so */
function schedDayIsLocal(date){
  var have = schedOfficeDates();
  return !have[date] && DB.local.some(function(o){ return o.date === date; });
}
/* Which bucket a load goes into. The office writes the team's schedule; an
   officer writes a stand-in for their own device. */
function schedBucket(){
  return (typeof isOffice === 'function' && !isOffice() && window.CLOUD && CLOUD.user)
    ? 'local' : 'office';
}
/* ---- what the office sent, against what was loaded here ----
   Called when the office's copy arrives. It says what differed before the
   local copy is retired, because an officer may already have worked from it
   and needs to know the reader got something wrong. */
function schedReconcile(){
  var have = schedOfficeDates(), days = {};
  DB.local.forEach(function(o){ if(have[o.date]) days[o.date] = 1; });
  var made = [];
  Object.keys(days).forEach(function(d){
    var mine = DB.local.filter(function(o){ return o.date === d; });
    var theirs = DB.office.filter(function(o){ return o.date === d; });
    var mineBy = {}, theirBy = {};
    mine.forEach(function(o){ mineBy[o.order] = o; });
    theirs.forEach(function(o){ theirBy[o.order] = o; });
    var gone  = mine.filter(function(o){ return !theirBy[o.order]; });
    var added = theirs.filter(function(o){ return !mineBy[o.order]; });
    var moved = theirs.filter(function(o){
      var m = mineBy[o.order];
      return m && ((+m.cases||0) !== (+o.cases||0) || (+m.pallets||0) !== (+o.pallets||0)
                || String(m.time||'') !== String(o.time||''));
    });
    made.push({ date:d, mine:mine.length, theirs:theirs.length,
      gone: gone.map(function(o){ return o.order; }),
      added: added.map(function(o){ return o.order; }),
      moved: moved.map(function(o){ return o.order; }) });
  });
  if(!made.length) return;
  DB.local = DB.local.filter(function(o){ return !have[o.date]; });
  DB.notes = made.concat(DB.notes).slice(0, 6);
}
/* One line, because an officer reading it is standing at a gate. Which day,
   who sent it, and the one number that tells them whether anything moved. */
function schedNoteText(n){
  if(n.theirs !== n.mine) return n.theirs + ' orders, was ' + n.mine;
  var moved = n.moved.length + n.added.length + n.gone.length;
  return moved ? moved + ' change' + (moved === 1 ? '' : 's') : 'no changes';
}
function schedNoteRead(date){
  DB.notes = DB.notes.filter(function(n){ return n.date !== date; });
  persist();
  if(typeof ycUpdateBadge === 'function') ycUpdateBadge();
}

/* ======================= helpers ======================= */
function $(id){ return document.getElementById(id); }
function toast(m){ var t=$('toast'); t.textContent=m; t.classList.add('show');
  clearTimeout(t._h); t._h=setTimeout(function(){t.classList.remove('show');},2600); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
/* Two date forms, on purpose, and they must not be mixed up:
   todayStr() is what an officer reads on the paper form, M/D/YY.
   isoDate()/isoToday() are what the records are stored and matched on. The gate
   log used to store the display form, so a log row could never be matched to
   the order it belonged to. Everything is stored ISO now. */
function todayStr(){ var d=new Date();
  return (d.getMonth()+1)+'/'+d.getDate()+'/'+String(d.getFullYear()).slice(2); }
function isoDate(v){
  var s = String(v == null ? '' : v).trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  var m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/);
  if(!m) return '';
  var y = m[3].length === 2 ? 2000 + (+m[3]) : +m[3];
  return y + '-' + String(+m[1]).padStart(2,'0') + '-' + String(+m[2]).padStart(2,'0');
}
function isoToday(){ var d=new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')
    +'-'+String(d.getDate()).padStart(2,'0'); }
function nowHHMM(){ var d=new Date();
  return String(d.getHours()).padStart(2,'0')+String(d.getMinutes()).padStart(2,'0'); }
function fmtDate(iso){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(iso||'')) return iso||'';
  var p = iso.split('-'), d = new Date(+p[0], +p[1]-1, +p[2]);
  var days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return days[d.getDay()]+' '+(+p[1])+'/'+(+p[2])+'/'+p[0];
}
var SECTIONS = ['home','office','block','stats','queue','search','sched','form','hist','yard','ycgrid','yardsheet','log','dar','settings','admin'];
var SECTION_TITLES = {
  queue:'Gate Queue', home:'', office:'', block:'Trailer block', stats:'Analytics', search:'Search', sched:'Schedule',
  form:'Seal Verification', hist:'Saved', yard:'Yard Check', ycgrid:'Yard Check', yardsheet:'Yard Check',
  log:'Log', dar:'Daily Activity Report', settings:'Settings', admin:'Admin' };
/* Navigation runs on real browser history, so the platform's own back works:
   one finger from the left edge on iOS/iPadOS and Android, two fingers on a Mac
   trackpad, and the browser back button on a laptop. */
/* Which screens a role may reach. The UI hides the rest, but the real
   enforcement is in the Firestore rules, not here. */
var OFFICE_ONLY  = ['office','block','stats','queue'];
var OFFICER_ONLY = ['yard','ycgrid','yardsheet','log','dar','form','hist','search'];
function isOffice(){ return (window.CLOUD && CLOUD.role) === 'office'; }
function homeSection(){ return isOffice() ? 'office' : 'home'; }
function applyRole(){
  var off = isOffice();
  document.body.classList.toggle('role-office', off);
  /* The role starts as officer and is corrected once the account document
     arrives, so the bell has to be recounted: the office was inheriting a
     count of yard checks that were never theirs to do. */
  call('ycUpdateBadge');
  /* and the admin panel decides what it shows by the account, which may only
     have arrived just now */
  if(curRoute().sec === 'admin') call('adminGate');
  var r = curRoute();
  var cur = r.sec, sub = r.sub;
  var shown = document.querySelector('section.on');
  var shownId = shown ? shown.id.replace('sec-','') : 'home';
  var blocked = off ? OFFICER_ONLY.indexOf(cur)>=0 : OFFICE_ONLY.indexOf(cur)>=0;
  if(cur==='home' && off) blocked = true;
  if(cur==='office' && !off) blocked = true;
  /* the visible screen can lag the recorded one on a deep link */
  if(!blocked && shownId !== cur) { go(cur, true, sub); return; }
  if(blocked) go(homeSection());
}
/* A route is a screen and, where a screen has one, the thing open inside it:
   #yardsheet/0800, #sched/2026-08-16/edit. Keeping that in the address means a
   refresh puts the officer back exactly where they were. */
function parseRoute(h){
  h = String(h||'').replace(/^#/,'');
  var i = h.indexOf('/');
  return i<0 ? { sec:h, sub:'' } : { sec:h.slice(0,i), sub:h.slice(i+1) };
}
function routeHash(sec, sub){ return '#'+sec+(sub ? '/'+sub : ''); }
function curRoute(){
  var st = history.state;
  if(st && st.sec) return { sec:st.sec, sub:st.sub||'' };
  return parseRoute(location.hash);
}
function routeSub(sec){ var r = curRoute(); return r.sec===sec ? r.sub : ''; }
/* a renderer that a later script file owns; before it loads, doing nothing is
   the right answer */
function call(fn, a){ var f = window[fn]; if(typeof f === 'function') return f(a); }
/* Cloud records can land after the route was restored, so give the open screen
   a second chance to show what the address actually asked for. */
/* ingest.js loads after this file, so a route restored while the page is
   still parsing cannot attach the loader. routeResync() calls this again once
   everything is there, which is the same arrangement the yard uses. */
function dzSync(name){
  if(typeof dzAttach !== 'function') return;
  if(name === 'sched')       dzAttach('dzhost_sched', 'schedule');
  else if(name === 'ycgrid') dzAttach('dzhost_yard', 'yard');
  else if(name === 'block')  dzAttach('dzhost_block', 'block');
  else if(typeof dzDetach === 'function') dzDetach();
}
function routeResync(){
  var r = curRoute();
  var shown = document.querySelector('section.on');
  /* only ever finish the screen that is actually open, so a resync can never
     drag the officer off somewhere they have since navigated to */
  if(!shown || shown.id !== 'sec-'+r.sec) return;
  if(r.sec==='sched'){
    if(!isOffice() && !r.sub && schedHasDay(isoToday())){
      go('sched', false, isoToday()+'/preview', true);
      return;
    }
    dayViewSync(r.sub);
  }
  if(r.sec==='yard'){ call('renderYardSlots'); call('renderYardHist'); call('ycStartTicking'); }
  if(r.sec==='block'){ call('blockRender'); call('blockViewSync', r.sub); }
  if(r.sec==='stats') call('renderStats');
  if(r.sec==='queue'){ call('renderQueue'); call('queueViewSync', r.sub); }
  if(r.sec==='block') call('blockBadge');
  if(r.sec==='dar'){ call('renderDar'); call('darStartTicking'); }
  if(r.sec==='office') call('officeStat');
  dzSync(r.sec);
  if(r.sec==='ycgrid'){
    if(r.sub) call('ycRestoreSlot', r.sub);
    call('renderYcGrid');
  }
  if(r.sec==='yardsheet'){
    if(r.sub) call('ycRestoreSlot', r.sub);
    call('renderYard');
  }
}
function go(name, fromHistory, sub, replace){
  var asked = name;
  sub = sub || '';
  if(SECTIONS.indexOf(name)<0) name = homeSection();
  if(name==='home' && isOffice()) name='office';
  if(name==='office' && !isOffice()) name='home';
  /* a role never lands on the other role's screens */
  if(isOffice() && OFFICER_ONLY.indexOf(name)>=0 && name!=='sched') name='office';
  if(!isOffice() && OFFICE_ONLY.indexOf(name)>=0) name='home';
  /* a redirected screen cannot keep the other screen's sub-state */
  if(name !== asked) sub = '';
  /* an officer's schedule IS today's sheet, so go straight to it */
  if(name==='sched' && !isOffice() && !sub && typeof schedHasDay==='function'
     && schedHasDay(isoToday())) sub = isoToday()+'/preview';
  /* ---- the back stack is the tree, not the diary ----
     The screens are a tree: home, its sections, their sub-places. Back walks
     UP that tree, the way it does in any app on the device. Recording every
     visit chronologically meant home piled up in the stack over and over, and
     an iPad edge-swipe from home re-opened sheets the officer had already
     closed. So: going DEEPER pushes, moving SIDEWAYS replaces, and going UP
     unwinds the entries that were pushed - the stack is never more than
     home > section > sub-place, and from home, back leaves the app. */
  if(!fromHistory){
    try{
      /* An unwind is mid-flight: history.go() has not landed yet. Whatever is
         asked for now becomes where the unwind lands, or a quick second tap
         would race the stack and lose. */
      if(NAV_PENDING){
        NAV_PENDING = {sec:name, sub:sub};
        throw 'queued';
      }
      var st = history.state || {};
      var curIdx = (typeof st.idx === 'number') ? st.idx : 0;
      var same = (st.sec === name) && ((st.sub||'') === sub);
      var homeTarget = (name === homeSection());
      if(same){
        /* nothing new to record */
      } else if(replace){
        history.replaceState({sec:name, sub:sub, idx:curIdx}, '', routeHash(name, sub));
      } else if(homeTarget && curIdx > 0){
        NAV_PENDING = {sec:name, sub:sub};
        history.go(-curIdx);
        return;
      } else if(homeTarget){
        history.replaceState({sec:name, sub:sub, idx:0}, '', routeHash(name, sub));
      } else if(st.sec === name && st.sub && !sub){
        /* closing a sub-place: one step up */
        NAV_PENDING = {sec:name, sub:''};
        history.go(-1);
        return;
      } else if(st.sec === name && st.sub && sub){
        /* preview to edit, one form step to the next: a mode, not a place */
        history.replaceState({sec:name, sub:sub, idx:curIdx}, '', routeHash(name, sub));
      } else if(st.sec === name || curIdx === 0 || sub){
        /* deeper: opening a sub-place, or the first step off home */
        history.pushState({sec:name, sub:sub, idx:curIdx+1}, '', routeHash(name, sub));
      } else if(curIdx > 1){
        /* a sideways hop out of somewhere deep: surface first, then swap */
        NAV_PENDING = {sec:name, sub:sub};
        history.go(-(curIdx-1));
        return;
      } else {
        /* section to section off the menu: sideways, one entry per level */
        history.replaceState({sec:name, sub:sub, idx:curIdx}, '', routeHash(name, sub));
      }
    }catch(e){}
  }
  SECTIONS.forEach(function(n){
    var sec=$('sec-'+n); if(sec) sec.classList.toggle('on', n===name);
  });
  $('hdrtitle').textContent = (name==='home') ? '' : (SECTION_TITLES[name] || '');
  var back=$('menubtn');
  if(back) back.hidden = (name === homeSection());
  menuFill();
  /* yard.js loads after this file, so a route restored while the page is still
     parsing calls into functions that do not exist yet. Skipping them here is
     safe: routeResync() finishes the job once everything has loaded. */
  if(name==='sched') renderSched();
  if(name==='office') call('officeStat');
  if(name==='block'){ call('blockRender'); call('blockViewSync', sub); }
  if(name==='stats') call('renderStats');
  if(name==='queue'){ call('renderQueue'); call('queueViewSync', sub); }
  else call('queueViewSync', '');
  if(name==='hist') renderHist();
  if(name==='log') renderLog();
  if(name==='dar'){ call('renderDar'); call('darStartTicking'); }
  else call('darStopTicking');
  if(name==='form'){
    sigInit();
    /* every empty box is marked on arrival, so the officer follows the red
       rather than discovering a gap at the end */
    markAllMissing();
    var st = parseInt(sub, 10);
    FORM_STEP = isNaN(st) ? 0 : st;
    renderFormStep();
  }
  if(name==='settings'){
    var i=$('set_offname'); if(i) i.value=getOfficerName();
    call('prefsRender');
  }
  if(name==='admin') call('adminGate');
  if(name!=='yardsheet' && name!=='ycgrid') call('ycExitView');
  if(name==='yard'){ call('renderYardSlots'); call('renderYardHist'); call('ycStartTicking'); }
  else if(name!=='yardsheet' && name!=='ycgrid') call('ycStopTicking');
  if(name==='ycgrid'){
    if(sub) call('ycRestoreSlot', sub);
    call('renderYcGrid');
  }
  if(name==='yardsheet'){
    if(sub) call('ycRestoreSlot', sub);
    call('renderYard');
  }
  /* the one loader goes to whichever screen is asking for a file */
  dzSync(name);
  if(name==='search'){ var q=$('q'); if(q) setTimeout(function(){ q.focus(); },60); }
  /* the day sheet lives inside the schedule, so it follows the route too */
  if(typeof dayViewSync==='function') dayViewSync(name==='sched' ? sub : '');
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
/* The menu hangs under the profile it belongs to. It is a menu, not a screen:
   a tap outside or Escape puts it away, and it never takes the app inert. */
function openMenu(e){
  if(e) e.stopPropagation();
  var d=$('drawer'), b=$('profbtn'); if(!d) return;
  if(!d.hidden){ closeMenu(); return; }
  menuFill();
  /* no point offering the screen the officer is already looking at */
  var home=$('um_home');
  if(home) home.hidden = (curRoute().sec === homeSection());
  d.hidden=false;
  if(b) b.setAttribute('aria-expanded','true');
  var first=d.querySelector('.ditem:not([hidden])'); if(first) first.focus();
}
function closeMenu(){
  var d=$('drawer'), b=$('profbtn'); if(!d || d.hidden) return;
  d.hidden=true;
  if(b){ b.setAttribute('aria-expanded','false'); if(b.focus) b.focus(); }
}
document.addEventListener('click', function(e){
  var d=$('drawer');
  if(d && !d.hidden && !d.contains(e.target) && !e.target.closest('#profbtn')) closeMenu();
});
/* the arrow does what the browser's own back does, so the two never disagree */
var NAV_PENDING = null;
function goBack(){
  var st = history.state;
  var idx = (st && typeof st.idx === 'number') ? st.idx : 0;
  /* only unwind entries this app pushed: at the base, back goes home in
     place rather than walking out into whatever was open before the app */
  if(idx > 0) history.back();
  else go(homeSection(), false, '', true);
}
function menuGo(name){ closeMenu(); go(name); }
window.addEventListener('popstate', function(e){
  /* an open menu swallows the first back, which is what a drawer should do */
  var d=$('drawer');
  if(d && !d.hidden){ closeMenu(); }
  /* the tail end of an unwind: we have surfaced, now stand on the target */
  if(NAV_PENDING){
    var pend = NAV_PENDING; NAV_PENDING = null;
    var at = e.state || {};
    var atIdx = (typeof at.idx === 'number') ? at.idx : 0;
    if(at.sec !== pend.sec || (at.sub||'') !== (pend.sub||'')){
      /* landing on a sub-place is a step DOWN from where we surfaced */
      if(pend.sub)
        history.pushState({sec:pend.sec, sub:pend.sub, idx:atIdx+1}, '',
          routeHash(pend.sec, pend.sub));
      else
        history.replaceState({sec:pend.sec, sub:'', idx:atIdx}, '',
          routeHash(pend.sec, ''));
    }
    go(pend.sec, true, pend.sub || '');
    return;
  }
  var st = e.state || parseRoute(location.hash);
  go(st.sec || 'home', true, st.sub || '');
});
(function(){
  var r = parseRoute(location.hash);
  var start = SECTIONS.indexOf(r.sec)>=0 ? r.sec : 'home';
  var sub = (start === r.sec) ? r.sub : '';
  try{
    history.replaceState({sec:start, sub:sub, idx:0}, '', routeHash(start, sub));
    /* Show that screen now, so nothing flashes; the parts owned by yard.js are
       filled in below. applyRole() corrects the choice when the role arrives. */
    go(start, true, sub);
  }catch(e){}
  window.addEventListener('DOMContentLoaded', function(){ routeResync(); });
})();
document.addEventListener('keydown', function(e){
  if(e.key==='Escape') closeMenu();
});

function toggle(id){ var e=$(id); e.style.display = e.style.display==='none'?'block':'none'; }
function stat(){
  var dates = {}; DB.orders.forEach(function(o){ dates[o.date]=1; });
  var ds = Object.keys(dates).sort();
  $('datastat').textContent = DB.orders.length
    ? DB.orders.length+' order'+(DB.orders.length===1?'':'s')+' loaded · '+ds.map(function(d){return fmtDate(d).replace(/ \d{4}$/,'');}).join('  |  ')
    : 'No schedule loaded yet. Go to the Schedule tab.';
}

/* ======================= import ======================= */
/* Excel copies what is on the screen, not what is in the cell, so a thousand
   arrives as "1,570". +"1,570" is NaN, and NaN||0 is a zero: every order of a
   thousand cases or more came in empty, and a sheet of 50,622 cases totalled
   11,332. Anything that is not a digit, a dot or a minus is not part of the
   number. */
function cellNum(v){
  var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}
function normalizeRow(o){
  return {
    date:String(o.date||'').trim(), zone:String(o.zone||'').trim(),
    priority:String(o.priority||'').trim(), detail:String(o.detail||'').trim(),
    time:String(o.time||'').trim(), in_yard:String(o.in_yard||o.inyard||'').trim(),
    order:String(o.order||o.order_number||'').trim(),
    vendor:String(o.vendor||o.vendor_name||'').trim(),
    carrier:String(o.carrier||'').trim(), contact:String(o.contact||'').trim(),
    cases:cellNum(o.cases), pallets:cellNum(o.pallets),
    /* where this row stood in the file it came from. Kept on the record, so
       the order survives the trip through Firestore, which returns documents
       in whatever order it likes. */
    seq: (o.seq == null || isNaN(+o.seq)) ? null : +o.seq
  };
}
/* the office's file is the authority on the order of a day, so rows are shown
   in the order they were loaded, and only fall back to sorting when there is
   no sequence to go on - an older schedule, loaded before this was kept */
function schedSeqCmp(a, b){
  var as = (a.seq == null) ? null : +a.seq, bs = (b.seq == null) ? null : +b.seq;
  if(as != null && bs != null) return as - bs;
  if(as != null) return -1;
  if(bs != null) return 1;
  var az = a.zone||'', bz = b.zone||'';
  if(az !== bz) return az < bz ? -1 : 1;
  return (a.time||'') < (b.time||'') ? -1 : 1;
}
/* What the receiving office actually sends.

   Their sheet is not a bare table. Row one is the day - "Tuesday, August 25,
   2026" - merged across the width. The header is under it, and the star column
   between Zones and Detail has no heading at all. There is a blank row between
   each zone, and a totals row at the foot. The office selects the lot in Excel
   and pastes it in, so all of that has to be read rather than rejected: taking
   row one for the header turned every column into "tuesday_august_25_2026" and
   the paste came back "Nothing to load".

   Names are matched with the spaces taken out, so "Order Number", "order_number"
   and a cell that wrapped to "Zone/s" all land in the same place. */
var SCHED_ALIAS = {
  ordernumber:'order', 'order#':'order', order:'order', ordernum:'order',
  vendor:'vendor', vendorname:'vendor',
  appointmentcarrier:'carrier', carrier:'carrier',
  contactname:'contact', contact:'contact',
  opencases:'cases', cases:'cases', pallets:'pallets', pallet:'pallets',
  zones:'zone', zone:'zone',
  inyard:'in_yard', 'inyard?':'in_yard',
  detail:'detail', time:'time', appttime:'time', date:'date',
  'priority(*)':'priority', 'priority(★)':'priority', priority:'priority'
};
function hdrKey(h){
  return String(h == null ? '' : h).toLowerCase().replace(/[^a-z0-9#?()*★]/g, '');
}
/* the scanner: quotes, and whichever of tab or comma the sheet actually uses */
function csvRows(text){
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
  return rows;
}
/* how many columns of a row are names we know: the header is the row that
   knows the most, not the row that happens to be first */
function hdrScore(row){
  var seen={}, n=0;
  (row||[]).forEach(function(c){
    var a = SCHED_ALIAS[hdrKey(c)];
    if(a && !seen[a]){ seen[a]=1; n++; }
  });
  return n;
}
function sheetHeaderAt(rows){
  var best=0, bestScore=0;
  for(var i=0; i<Math.min(rows.length, 15); i++){
    var sc = hdrScore(rows[i]);
    if(sc > bestScore){ bestScore=sc; best=i; }
  }
  return bestScore >= 3 ? best : 0;
}
/* The star column carries no heading, so it is known by what is in it: stars,
   and nothing else. Guessing by position would break the first time somebody
   moved a column. */
function nameStarColumn(hdr, body){
  hdr.forEach(function(h, i){
    if(h) return;
    var stars=0, other=0;
    body.forEach(function(r){
      var v = String((r||[])[i] == null ? '' : r[i]).trim();
      if(!v) return;
      if(/^[★⭐*x]$/i.test(v)) stars++; else other++;
    });
    if(stars && !other) hdr[i] = 'priority';
  });
}
/* the day, from the title the office puts over the table */
function sheetDate(rows, headerAt){
  for(var i=0; i<headerAt; i++){
    var line = (rows[i]||[]).join(' ').replace(/\s+/g,' ').trim();
    var d = line && (typeof dateFromName === 'function') && dateFromName(line);
    if(d) return d;
  }
  return '';
}
/* The foot of the sheet: no order number, but the two figures the office adds
   up. Kept, because they are what says whether anything was lost on the way in. */
function sheetTotals(rows, headerAt, hdr){
  var ci = hdr.indexOf('cases'), pi = hdr.indexOf('pallets'), oi = hdr.indexOf('order');
  if(ci < 0 && pi < 0) return null;
  var num = function(v){ var n = parseFloat(String(v==null?'':v).replace(/[^0-9.-]/g,'')); return isNaN(n)?0:n; };
  for(var i = rows.length - 1; i > headerAt; i--){
    var r = rows[i] || [];
    if(oi >= 0 && String(r[oi]||'').trim()) return null;   /* a real row: no totals line */
    var c = ci<0?0:num(r[ci]), p = pi<0?0:num(r[pi]);
    if(c || p) return { cases:c, pallets:p };
  }
  return null;
}
/* set by the last parse, so the draft can say whether the totals still add up */
var SCHED_SHEET_TOTALS = null;
function parseCSV(text){
  var rows = csvRows(text);
  SCHED_SHEET_TOTALS = null;
  if(!rows.length) return [];
  var at = sheetHeaderAt(rows);
  var body = rows.slice(at + 1);
  var hdr = (rows[at]||[]).map(function(h){ var k = hdrKey(h); return SCHED_ALIAS[k] || k; });
  nameStarColumn(hdr, body);
  var day = sheetDate(rows, at);
  SCHED_SHEET_TOTALS = sheetTotals(rows, at, hdr);
  return body.map(function(r){
    var o={};
    hdr.forEach(function(h,i){ if(h) o[h] = r[i]; });
    if(day && !String(o.date == null ? '' : o.date).trim()) o.date = day;
    return o;
  });
}
function mergeOrders(arr){
  var into = (schedBucket() === 'local') ? DB.local : DB.office;
  var add=0, upd=0;
  arr.map(normalizeRow).forEach(function(n){
    if(!n.order) return;
    var i = into.findIndex(function(o){ return o.order===n.order && o.date===n.date; });
    if(i>=0){ into[i]=n; upd++; } else { into.push(n); add++; }
  });
  schedRebuild();
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
  /* the figures at the foot of the sheet, so the draft can say whether what
     arrived still adds up to what the office sent */
  SCHED_CLAIM = SCHED_SHEET_TOTALS;
  receiveOrders(arr);
}
/* Whoever loads it checks it first. An officer with the printed sheet in
   their hand can load it rather than wait for the office, and the same grid
   is what they correct it in. */
function receiveOrders(arr){ stageOrders(arr); }
/* every route in - the + menu, a drag, a paste - ends at the same reader */
$('file').addEventListener('change', function(){
  /* .files is live: clearing .value empties it, so take a copy first */
  var files = Array.prototype.slice.call(this.files || []);
  this.value = '';
  if(typeof ingestFiles === 'function') ingestFiles(files);
});
function importPaste(){
  var t = $('paste').value;
  ING_SOURCE = '';
  if(typeof ingPasteClose === 'function') ingPasteClose(); else $('paste').value='';
  /* the same box loads a schedule or a trailer list, depending on the screen
     the loader is standing on */
  if(typeof DZ_MODE === 'undefined' || DZ_MODE === 'schedule') ingest(t);
  else if(DZ_MODE === 'block') ingBlockText(t, 'paste');
  else ingYardText(t, 'paste');
}
/* One day at a time. Clearing everything is a different button, and asking
   for the day by name is what stops the wrong one going. */
function schedDeleteDay(date){
  var rows = DB.orders.filter(function(o){ return o.date === date; });
  if(!rows.length){ toast('Nothing loaded for that day'); return; }
  var when = (typeof fmtLongDate === 'function' && fmtLongDate(date)) || date;
  if(!confirm('Delete the schedule for ' + when + '?\n\n'
      + rows.length + (rows.length === 1 ? ' order' : ' orders')
      + ' will be removed, and the yard will no longer see them. '
      + 'Load the day again to replace it.')) return;
  schedDropDay(date, when);
}
/* separate, because signed in it has to leave the team's copy too, and
   cloud.js wraps this the same way it wraps every other write */
function schedDropDay(date, when, note){
  DB.office = DB.office.filter(function(o){ return o.date !== date; });
  DB.local  = DB.local.filter(function(o){ return o.date !== date; });
  schedRebuild();
  persist(); stat(); renderSched();
  toast(note || ('Deleted ' + (when || date) + '. Load it again when you have a good copy.'));
}
function clearAll(){
  if(!confirm('Delete ALL loaded schedule data? Saved forms are kept.')) return;
  DB.office=[]; DB.local=[]; DB.notes=[]; schedRebuild();
  persist(); stat(); renderSched(); toast('Schedule cleared');
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
/* A schedule often carries its day only in the file name -
   schedule_20260825.csv, "Aug 25 2026 loads.xlsx" - and never in a column.
   Rows loaded without a date have no day to sit under: no heading, and last
   in a list that reads newest first. The name is read, and today stands in
   when the name says nothing either.

   This runs when a file is loaded and touches nothing else: no network, no
   writing back, no navigating. An earlier attempt did all three and took the
   app down with it. */
var ING_SOURCE = '';
var MON_ABBR = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
function dateFromName(name){
  var s = String(name || '').replace(/\.[a-z0-9]+$/i, '');
  var m;
  /* 20260825 */
  if((m = s.match(/(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/)))
    return m[1]+'-'+m[2]+'-'+m[3];
  /* 2026-08-25, 2026_08_25, 2026.08.25 */
  if((m = s.match(/(20\d{2})[-_.](\d{1,2})[-_.](\d{1,2})/)))
    return isoParts(m[1], m[2], m[3]);
  /* 08-25-2026 and 8/25/26 */
  if((m = s.match(/(\d{1,2})[-_.\/](\d{1,2})[-_.\/](20\d{2}|\d{2})\b/)))
    return isoParts(m[3].length === 2 ? '20'+m[3] : m[3], m[1], m[2]);
  /* Aug 25 2026, August 25, 2026 */
  if((m = s.match(/([a-z]{3,9})[^a-z0-9]{0,3}(\d{1,2})(?:st|nd|rd|th)?[^0-9]{0,3}(20\d{2})/i)))
    return byMonthName(m[1], m[3], m[2]);
  /* 25 Aug 2026 */
  if((m = s.match(/(\d{1,2})(?:st|nd|rd|th)?[^a-z0-9]{0,3}([a-z]{3,9})[^0-9]{0,3}(20\d{2})/i)))
    return byMonthName(m[2], m[3], m[1]);
  return '';
}
function byMonthName(name, y, d){
  var mi = MON_ABBR.indexOf(String(name).slice(0,3).toLowerCase());
  return mi < 0 ? '' : isoParts(y, mi+1, d);
}
function isoParts(y, mo, d){
  mo = +mo; d = +d;
  if(!(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return '';
  return y + '-' + (mo<10?'0':'') + mo + '-' + (d<10?'0':'') + d;
}
/* the day a file's rows belong to when the rows themselves do not say */
function schedFillDate(){
  return dateFromName(ING_SOURCE) || isoToday();
}
function stageOrders(arr, keepOrder){
  var rows = (arr||[]).map(normalizeRow).filter(function(n){ return n.order; });
  if(!rows.length){ toast('Nothing to load'); return; }
  /* Whatever it was loaded from - a spreadsheet, a CSV, a photograph - is
     checked against that source line by line, so the rows stay in the order
     the source had them. Anything else makes the office read both twice. */
  /* the day, if the file never gave one */
  var fill = schedFillDate();
  rows.forEach(function(r, i){ r.seq = i; if(!r.date) r.date = fill; });
  void keepOrder;
  SCHED_DRAFT = rows;
  schedRenderDraft();
  toast('Loaded '+rows.length+' rows. Check them, then preview.');
}
/* What the photograph said the totals were, so the office is told when the
   reader has plainly got it wrong rather than being left to notice. */
var SCHED_CLAIM = null;
function schedTally(){
  var el = $('drafttally'); if(!el) return;
  if(!SCHED_DRAFT || !SCHED_DRAFT.length || !SCHED_CLAIM){ el.hidden = true; return; }
  var cases = 0, pallets = 0;
  SCHED_DRAFT.forEach(function(r){ cases += (+r.cases||0); pallets += (+r.pallets||0); });
  var okCases   = !SCHED_CLAIM.cases   || cases   === SCHED_CLAIM.cases;
  var okPallets = !SCHED_CLAIM.pallets || pallets === SCHED_CLAIM.pallets;
  var okRows    = !SCHED_CLAIM.rows    || SCHED_DRAFT.length === SCHED_CLAIM.rows;
  if(okCases && okPallets && okRows){
    el.className = 'warn ok';
    el.innerHTML = '\u2714 The totals match the sheet: <b>' + SCHED_DRAFT.length
      + '</b> orders, <b>' + cases.toLocaleString() + '</b> cases, <b>'
      + pallets.toLocaleString() + '</b> pallets.';
    el.hidden = false;
    return;
  }
  el.className = 'warn';
  var says = [];
  if(!okRows)    says.push('<b>' + SCHED_DRAFT.length + '</b> orders, not ' + SCHED_CLAIM.rows);
  if(!okCases)   says.push('<b>' + cases.toLocaleString() + '</b> cases, not '
                           + SCHED_CLAIM.cases.toLocaleString());
  if(!okPallets) says.push('<b>' + pallets.toLocaleString() + '</b> pallets, not '
                           + SCHED_CLAIM.pallets.toLocaleString());
  el.innerHTML = '\u26a0 <b>This does not add up to the sheet.</b> The reader got '
    + says.join(', ') + '. Pen marks and creases throw it off. Correct the rows below, '
    + 'or load the .xlsx instead.';
  el.hidden = false;
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
function schedInvalidate(){ schedTally(); }
function colLetter(i){
  var s=''; i++;
  while(i>0){ var m=(i-1)%26; s=String.fromCharCode(65+m)+s; i=Math.floor((i-1)/26); }
  return s;
}
function dgTableHTML(rows, setFn, delFn){
  var letters = '<tr class="dgcols"><th class="gut"></th>'
    + DG_COLS.map(function(c,i){ return '<th style="min-width:'+c.w+'px">'+colLetter(i)+'</th>'; }).join('')
    + '<th class="gut"></th></tr>';
  var head = '<tr class="dghdr"><th class="gut">1</th>'
    + DG_COLS.map(function(c){ return '<th>'+esc(c.t)+'</th>'; }).join('')
    + '<th class="gut"></th></tr>';
  var seen = [], body = rows.map(function(r,i){
    var di = seen.indexOf(r.date); if(di<0){ seen.push(r.date); di = seen.length-1; }
    return '<tr class="d'+(di%2)+'"><td class="gut">'+(i+2)+'</td>'
      + DG_COLS.map(function(c){
          return '<td><input value="'+esc(r[c.k]==null?'':String(r[c.k]))+'"'
            + ' oninput="'+setFn+'('+i+',\''+c.k+'\',this.value)"></td>';
        }).join('')
      + '<td class="gut"><button class="dgdel" onclick="'+delFn+'('+i+')">\u2715</button></td></tr>';
  }).join('');
  var cases=0, pallets=0;
  rows.forEach(function(r){ cases+=(+r.cases||0); pallets+=(+r.pallets||0); });
  var foot = '<tr class="dgtot"><td class="gut"></td>'
    + '<td colspan="'+(DG_COLS.length-2)+'">'+rows.length+' order'+(rows.length===1?'':'s')+'</td>'
    + '<td class="num">'+cases.toLocaleString()+'</td>'
    + '<td class="num">'+pallets.toLocaleString()+'</td>'
    + '<td class="gut"></td></tr>';
  return '<div class="dgwrap"><table class="dg">'+letters+head+body+foot+'</table></div>';
}
/* Short, and different depending on who is reading it. An empty screen says
   what is missing; a screen with a schedule on it just names the action. */
function schedLoadNote(){
  var t = $('loadttl'), h = $('loadhint'), sec = $('sec-sched');
  if(!t || !h) return;
  var empty = !DB.orders.length;
  if(sec) sec.classList.toggle('emptysched', empty);
  if(isOffice()){
    t.textContent = empty ? 'No schedule yet' : 'Load the schedule';
    h.textContent = 'Checked here before anything reaches the yard.';
    return;
  }
  t.textContent = empty ? 'No schedule yet' : 'Load a schedule';
  h.textContent = 'Stays on this device until the office sends theirs.';
}
function schedRenderDraft(){
  var card=$('draftcard'); if(!card) return;
  if(!SCHED_DRAFT || !SCHED_DRAFT.length){ card.hidden = true; return; }
  card.hidden = false;
  $('draftcnt').textContent = '('+SCHED_DRAFT.length+')';
  $('draftgrid').innerHTML = dgTableHTML(SCHED_DRAFT, 'schedSet', 'schedDel');
  schedInvalidate();
}
function schedDiscard(){
  if(!confirm('Discard this schedule without submitting it?')) return;
  schedPreviewClose();
  SCHED_DRAFT = null; SCHED_CLAIM = null; schedRenderDraft();
  var c=$('draftcard'); if(c) c.hidden = true;
  toast('Discarded');
}
/* the preview is the sheet exactly as it prints */
function schedDayTable(day){
  var cases=0, pallets=0;
  day.forEach(function(r){ cases+=(+r.cases||0); pallets+=(+r.pallets||0); });
  return '<div class="prnwrap"><table class="prn"><tr>'
    /* column order follows the printed sheet: the zone, then its priority star */
    + '<th>Zones</th><th></th><th>Detail</th><th>Time</th><th>In Yard</th>'
    + '<th>Order Number</th><th>Vendor Name</th><th>Appointment Carrier</th>'
    + '<th>Contact Name</th><th class="num">Open Cases</th><th class="num">Pallets</th></tr>'
    + day.map(function(r){
        return '<tr><td>'+esc(r.zone)+'</td>'
          + '<td>'+(r.priority?'\u2605':'')+'</td>'
          + '<td>'+esc(r.detail)+'</td><td>'+esc(r.time)+'</td>'
          + '<td>'+esc(r.in_yard)+'</td><td>'+esc(r.order)+'</td>'
          + '<td>'+esc(r.vendor)+'</td><td>'+esc(r.carrier)+'</td><td>'+esc(r.contact)+'</td>'
          + '<td class="num">'+(+r.cases||0).toLocaleString()+'</td>'
          + '<td class="num">'+(+r.pallets||0)+'</td></tr>';
      }).join('')
    + '<tr class="tot"><td colspan="9">'+day.length+' order'+(day.length===1?'':'s')+'</td>'
    + '<td class="num">'+cases.toLocaleString()+'</td>'
    + '<td class="num">'+pallets.toLocaleString()+'</td></tr>'
    + '</table></div>';
}
function schedDaySummary(day){
  var cases=0, pallets=0;
  day.forEach(function(r){ cases+=(+r.cases||0); pallets+=(+r.pallets||0); });
  return day.length+' order'+(day.length===1?'':'s')
    + ' \u00b7 '+cases.toLocaleString()+' cases \u00b7 '+pallets.toLocaleString()+' pallets';
}
/* The same three figures, but as three columns rather than one sentence, so
   they line up down the list and can be compared at a glance. */
function schedDayStats(day){
  var cases=0, pallets=0;
  day.forEach(function(r){ cases+=(+r.cases||0); pallets+=(+r.pallets||0); });
  return '<span class="dbsum">'
    + '<span class="dbstat n1"><b>'+day.length+'</b><span>'
    +   (day.length===1?'order':'orders')+'</span></span>'
    + '<span class="dbstat n2"><b>'+cases.toLocaleString()+'</b><span>cases</span></span>'
    + '<span class="dbstat n3"><b>'+pallets.toLocaleString()+'</b><span>pallets</span></span>'
    + '</span>';
}
/* Line icons rather than emoji: emoji are a different weight and colour on
   every device, and three of them side by side never sit straight. */
var DB_ICONS = {
  preview: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/>'
         + '<circle cx="12" cy="12" r="2.6"/></svg>',
  edit:    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z"/>'
         + '<path d="M14.5 6.5 17.5 9.5"/></svg>',
  del:     '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/>'
         + '<path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7"/>'
         + '<path d="M6.5 7l.8 12a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9L17.5 7"/>'
         + '<path d="M10 11v6M14 11v6"/></svg>'
};
function schedByDate(rows){
  var bydate = {};
  rows.forEach(function(r){ (bydate[r.date] = bydate[r.date] || []).push(r); });
  Object.keys(bydate).forEach(function(d){
    bydate[d].sort(schedSeqCmp);
  });
  return bydate;
}
/* rows as they print. collapsible gives one bar per day, opened one at a time. */
function schedPrintHTML(rows, collapsible){
  if(!rows || !rows.length) return '<div class="empty">Nothing loaded.</div>';
  var bydate = schedByDate(rows);
  /* The list of loaded days reads newest first: today is what the office is
     working on, and yesterday is history. A printed copy still runs forward. */
  var days = Object.keys(bydate).sort();
  if(collapsible) days.reverse();
  return days.map(function(d){
    var day = bydate[d];
    if(!collapsible){
      return '<div class="prnhead">'
        + '<div class="prnconf">MARTIN BROWER, Inc. Confidential</div>'
        + '<div class="prndate">'+esc(fmtLongDate(d))+'</div></div>'
        + schedDayTable(day);
    }
    return '<div class="dayacc" data-date="'+esc(d)+'">'
      + '<div class="daybar">'
      +   '<button type="button" class="dbmain" onclick="dayViewOpen(\''+esc(d)+'\',\'preview\')">'
      +     '<span class="dbtext">'
      +       '<span class="dbconf">MARTIN BROWER, Inc. Confidential</span>'
      +       '<span class="dbdate">'+esc(fmtLongDate(d))+'</span>'
      +     '</span>'
      +     schedDayStats(day)
      +   '</button>'
      +   '<span class="dbicons">'
      +     '<button type="button" class="dbico" title="Preview" aria-label="Preview '+esc(fmtLongDate(d))+'"'
      +       ' onclick="dayViewOpen(\''+esc(d)+'\',\'preview\')">'+DB_ICONS.preview+'</button>'
      +     (isOffice()
              ? '<button type="button" class="dbico" title="Edit" aria-label="Edit '+esc(fmtLongDate(d))+'"'
                + ' onclick="dayViewOpen(\''+esc(d)+'\',\'edit\')">'+DB_ICONS.edit+'</button>'
                /* a day that came in wrong is thrown away and sent again,
                   which is faster than correcting forty rows by hand */
                + '<button type="button" class="dbico dbdel" title="Delete this day"'
                + ' aria-label="Delete '+esc(fmtLongDate(d))+'"'
                + ' onclick="schedDeleteDay(\''+esc(d)+'\')">'+DB_ICONS.del+'</button>'
              : '')
      +   '</span>'
      + '</div></div>';
  }).join('');
}
/* A day opens over the whole window: read it, edit it, save it back.
   Saving shows the printed preview again and asks for a confirmation, because
   officers may already be working from this schedule. */
var DAYVIEW = null, DV_PUSHED = false;
function dayViewOpen(date, mode){
  if(!DB.orders.some(function(o){ return o.date===date; })){ toast('Nothing on that day'); return; }
  go('sched', false, date+'/'+(mode==='edit' ? 'edit' : 'preview'));
  DV_PUSHED = true;
}
/* the overlay is whatever the route says it is */
function dayViewSync(sub){
  var p = String(sub||'').split('/');
  var date = p[0]||'', mode = (p[1]==='edit' && isOffice()) ? 'edit' : 'preview';
  if(!date){
    if(DAYVIEW && DAYVIEW.dirty &&
       !confirm('You have unsaved changes to this day. Leave without saving?')){
      go('sched', false, DAYVIEW.date+'/'+DAYVIEW.mode);
      return;
    }
    dayViewHide();
    return;
  }
  if(DAYVIEW && DAYVIEW.date === date){
    if(DAYVIEW.mode !== mode){ DAYVIEW.mode = mode; DAYVIEW.confirming = false; dayViewRender(); }
    return;
  }
  var rows = DB.orders.filter(function(o){ return o.date===date; })
    .map(function(o){ return JSON.parse(JSON.stringify(o)); });
  /* on a refresh the schedule may not have arrived yet; renderSched calls back */
  if(!rows.length){ dayViewHide(); return; }
  DAYVIEW = { date: date, mode: mode, rows: rows, dirty: false, confirming: false };
  var v = $('dayview');
  v.hidden = false;
  document.body.classList.add('dayview-open');
  dayViewRender();
  var b = $('dv_back'); if(b) b.focus();
}
function dayViewHide(){
  DAYVIEW = null; DV_PUSHED = false;
  var v = $('dayview'); if(v) v.hidden = true;
  document.body.classList.remove('dayview-open');
}
function dayViewClose(){
  /* for an officer the sheet is the schedule, so there is nothing behind it */
  if(!isOffice()){ DV_PUSHED = false; go('home'); return; }
  if(DV_PUSHED){ DV_PUSHED = false; history.back(); }
  else go('sched');
}
function dayViewMode(mode){
  /* switching view is not a place of its own, so back still leaves the day */
  if(mode==='edit' && !isOffice()) return;
  if(DAYVIEW) go('sched', false, DAYVIEW.date+'/'+mode, true);
}
function dayViewSet(i,k,v){
  if(!DAYVIEW || !DAYVIEW.rows[i]) return;
  DAYVIEW.rows[i][k] = (k==='cases'||k==='pallets') ? (parseInt(v,10)||0) : v;
  DAYVIEW.dirty = true; DAYVIEW.confirming = false;
  dayViewChrome();
}
function dayViewDel(i){
  if(!DAYVIEW) return;
  DAYVIEW.rows.splice(i,1);
  DAYVIEW.dirty = true; DAYVIEW.confirming = false;
  dayViewRender();
}
function dayViewSave(){
  if(!DAYVIEW) return;
  if(!DAYVIEW.rows.length){ toast('A day cannot be left with no orders'); return; }
  DAYVIEW.confirming = true; DAYVIEW.mode = 'preview';
  dayViewRender();
  toast('Check the changes, then confirm');
}
function dayViewConfirm(){
  if(!DAYVIEW) return;
  var n = DAYVIEW.rows.length, date = DAYVIEW.date, rows = DAYVIEW.rows;
  DAYVIEW.dirty = false;
  publishDay(date, rows);
  dayViewClose();
  toast('Updated '+n+' order'+(n===1?'':'s')+' for the yard');
}
/* Publishing an edited day replaces that day outright, so a row the office
   deleted really goes, instead of lingering from the earlier upload. */
function publishDay(date, rows){
  var list = rows.map(normalizeRow).filter(function(r){ return r.order; });
  var into = (schedBucket() === 'local') ? 'local' : 'office';
  DB[into] = DB[into].filter(function(o){ return o.date !== date; }).concat(list);
  schedRebuild();
  persist(); stat(); renderSched();
}
function dayViewChrome(){
  if(!DAYVIEW) return;
  $('dv_date').textContent = fmtLongDate(DAYVIEW.date);
  $('dv_preview').classList.toggle('on', DAYVIEW.mode==='preview');
  $('dv_edit').classList.toggle('on', DAYVIEW.mode==='edit');
  $('dv_save').hidden    = !(DAYVIEW.mode==='edit' && DAYVIEW.dirty);
  $('dv_confirm').hidden = !DAYVIEW.confirming;
}
function dayViewRender(){
  if(!DAYVIEW) return;
  dayViewChrome();
  $('dv_body').innerHTML = DAYVIEW.mode==='edit'
    ? dgTableHTML(DAYVIEW.rows, 'dayViewSet', 'dayViewDel')
    : (DAYVIEW.confirming
        ? '<div class="dvnote">These are your changes. Confirm to send them to the yard.</div>'
          + schedDayTable(DAYVIEW.rows)
        : schedDayTable(DAYVIEW.rows));
}
document.addEventListener('keydown', function(e){
  if(e.key!=='Escape') return;
  if(DAYVIEW){ dayViewClose(); return; }
  var al=$('anlist');
  if(al && !al.hidden && typeof anListClose==='function'){ anListClose(); return; }
  var bv=$('bkview');
  if(bv && !bv.hidden && typeof blockViewClose==='function') blockViewClose();
});

var DRAFTVIEW_OPEN = false;
function schedPreview(){
  if(!SCHED_DRAFT || !SCHED_DRAFT.length){ toast('Nothing to preview'); return; }
  var v = $('draftview'); if(!v) return;
  $('dfv_body').innerHTML = schedPrintHTML(SCHED_DRAFT, false);
  var d = $('dfv_date');
  var days = {}; SCHED_DRAFT.forEach(function(r){ if(r.date) days[r.date] = 1; });
  var only = Object.keys(days);
  if(d) d.textContent = only.length === 1 ? (fmtLongDate(only[0]) || 'Preview') : 'Preview';
  v.hidden = false;
  document.body.classList.add('dayview-open');
  DRAFTVIEW_OPEN = true;
  $('dfv_body').scrollTop = 0;
}
function schedPreviewClose(){
  var v = $('draftview'); if(v) v.hidden = true;
  document.body.classList.remove('dayview-open');
  DRAFTVIEW_OPEN = false;
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
  schedPreviewClose();
  mergeOrders(SCHED_DRAFT);
  SCHED_DRAFT = null; SCHED_CLAIM = null;
  renderSched();
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
function schedHasDay(d){
  return DB.orders.some(function(o){ return o.date === d; });
}
function renderSched(){
  if(typeof suggestSync==='function') suggestSync();
  schedLoadNote();
  var card = $('schedcard'), none = $('schednone');
  if(isOffice()){
    if(card) card.hidden = false;
    if(none) none.hidden = true;
    $('cnt').textContent = DB.orders.length ? '('+DB.orders.length+')' : '';
    $('sched').innerHTML = schedPrintHTML(DB.orders, true);
    return;
  }
  /* The tile says today's loads, so that is what an officer gets: today's
     sheet, whole, in one page. Earlier days stay on file for the office. */
  var t = isoToday();
  var n = DB.orders.filter(function(o){ return o.date === t; }).length;
  $('cnt').textContent = n ? '('+n+')' : '';
  $('sched').innerHTML = '';
  if(card) card.hidden = !n;
  if(none){
    /* Nothing at all is a different problem from nothing today, and the
       officer can do something about only one of them. With nothing at all
       the load card is the empty state and says so, so this would only be
       the same sentence twice. */
    none.hidden = !!n || !DB.orders.length;
    none.textContent = 'Nothing scheduled for today.';
  }
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
  FORM_STEP = 0; if(typeof renderFormStep==='function') renderFormStep();
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
function markAllMissing(){
  Object.keys(REQ_FIELDS).forEach(markMissing);
  /* the choices and the signature are required too, and are not text boxes */
  [['c_sealtype', CH.sealtype], ['c_sealcond', CH.sealcond], ['c_fuel', CH.fuel]]
    .forEach(function(p){ var el=$(p[0]); if(el) el.classList.toggle('miss', !p[1]); });
  var sw=$('sigwrap'); if(sw) sw.classList.toggle('miss', !window.sigHas);
  var pid=$('f_photoid'); if(pid && pid.parentElement)
    pid.parentElement.classList.toggle('miss', !pid.checked);
  formStepMarks();
}
/* a page whose boxes are not all filled says so on its own dot */
function formStepMarks(){
  var steps = formStepsEls(); if(!steps.length) return;
  var dots = $('f_dots'); if(!dots) return;
  steps.forEach(function(el, i){
    var d = dots.children[i]; if(!d) return;
    d.classList.toggle('want', el.querySelector('.miss') != null);
  });
}
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
/* ---- the form, one page at a time ---- */
var FORM_STEP = 0;
function formStepsEls(){
  return [].slice.call(document.querySelectorAll('#sec-form .fstep'));
}
function renderFormStep(){
  var steps = formStepsEls(); if(!steps.length) return;
  FORM_STEP = Math.max(0, Math.min(FORM_STEP, steps.length-1));
  var last = steps.length - 1;
  steps.forEach(function(el, i){ el.hidden = i !== FORM_STEP; });
  /* the preview is the form itself: it needs no heading above it, and its
     buttons live with it rather than in a bar of their own */
  var onPreview = FORM_STEP === last;
  $('f_head').hidden = onPreview;
  $('f_nav').hidden = onPreview;
  /* always the signed-in officer, never whatever was typed last */
  var v = $('f_verified'); if(v) v.value = getOfficerName();
  $('f_stepno').textContent = FORM_STEP === last
    ? 'Read it, then send it'
    : 'Page ' + (FORM_STEP+1) + ' of ' + last;
  var back = $('f_back'), next = $('f_next');
  back.hidden = FORM_STEP === 0;
  next.hidden = onPreview;
  /* the last page before the preview offers the preview, not another page */
  next.textContent = (FORM_STEP === last-1) ? 'Preview' : 'Next';
  $('f_dots').innerHTML = steps.map(function(_, i){
    return '<i class="'+(i===FORM_STEP?'on':(i<FORM_STEP?'done':''))+'"></i>'; }).join('');
  window.scrollTo(0,0);
}
function formStep(d){
  var steps = formStepsEls(), last = steps.length - 1;
  /* stepping onto the preview draws it: there is nothing to look at otherwise */
  if(d > 0 && FORM_STEP === last-1){ previewForm(); return; }
  formGoStep(FORM_STEP + d);
}
/* Each page is a place of its own, so a two-finger swipe on an iPad and the
   browser's back button both walk back through the form. */
function formGoStep(i){
  var steps = formStepsEls();
  i = Math.max(0, Math.min(i, steps.length-1));
  if(i === FORM_STEP){ renderFormStep(); return; }
  FORM_STEP = i;
  go('form', false, i ? String(i) : '');
}

function previewForm(){
  /* the asking happens at Submit, which is the last chance; here the officer
     is only being shown what they have */
  markAllMissing();
  checkSeal();
  drawPaper(collect(), function(cv){
    $('preview').innerHTML='<img alt="form preview" src="'+cv.toDataURL('image/png')+'">';
    var a=$('actions'); if(a) a.style.display='block';
    formGoStep(formStepsEls().length - 1);
    toast('Read it through, then push it to the receiving office'); });
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
(function(){ var m=document.getElementById('set_manager'); if(!m) return;
  m.value = (sget('gc_manager')||'');
  m.addEventListener('input', function(){ sset('gc_manager', m.value.trim()); }); })();
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
/* Sending and filing are one act. Two buttons meant a form could go to the
   office and never reach Saved, or the other way round. */
function pushForm(){
  var d = collect();
  if(!d.po){ toast('PO / Order number is empty'); return; }
  /* the last chance to notice: the officer is told exactly what is missing and
     has to say they meant it */
  var m = blankFields();
  if(m.length && !confirm(m.length + (m.length===1?' field is':' fields are') + ' still empty:'
      + '\n\n\u2022 ' + m.join('\n\u2022 ')
      + '\n\nOK = send it anyway   \u00b7   Cancel = go back and fill them')) return;
  /* Where it goes is the admin panel's business, not this button's. Until
     there was a panel this only ever emailed, and the copy it kept stayed on
     the officer's own phone - so the receiving office's gate queue never saw
     a form that had been submitted, only one that had been saved. */
  formDraftClear();
  var toApp   = (typeof admGoes === 'function') ? admGoes('form', 'app')   : true;
  var toEmail = (typeof admGoes === 'function') ? admGoes('form', 'email') : true;
  if(toApp) formPush(d); else { DB.forms.unshift(d); persist(); }
  if(DB.forms.length>60) DB.forms.length=60;
  renderHist();
  if(typeof beep==='function') beep();
  if(toEmail) emailData(d);
  else toast('Sent to the receiving office');
}
/* on the officer's device when there is no signal, and to the team when
   there is - the queue the office reads is the forms collection */
function formPush(d){
  DB.forms.unshift(d);
  persist();
  if(typeof formCloudPush === 'function') formCloudPush(d);
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
/* Saved forms read as a diary: newest day first, each day headed, and the
   time down the left so a run of forms scans as a sequence rather than a
   wall of repeated dates. */
function renderHist(){
  var host = $('hist'); if(!host) return;
  if(!DB.forms.length){ host.innerHTML='<div class="empty">No saved forms yet.</div>'; return; }

  var rows = DB.forms.map(function(f, i){ return { f:f, i:i }; });
  rows.sort(function(a, b){
    var ad = isoDate(a.f.datein) || '', bd = isoDate(b.f.datein) || '';
    if(ad !== bd) return ad < bd ? 1 : -1;
    return String(b.f.timein||'').localeCompare(String(a.f.timein||''));
  });

  var byDay = {}, order = [];
  rows.forEach(function(r){
    var d = isoDate(r.f.datein) || String(r.f.datein||'');
    if(!byDay[d]){ byDay[d] = []; order.push(d); }
    byDay[d].push(r);
  });

  host.innerHTML = order.map(function(d){
    var list = byDay[d];
    return '<div class="hday">'
      + '<div class="hdayhd"><b>'+esc(fmtLongDate(d) || d || 'No date')+'</b>'
      +   '<span>'+list.length+' form'+(list.length===1?'':'s')+'</span></div>'
      + list.map(function(r){
          var f = r.f, bad = String(f.sealcond||'').toUpperCase();
          bad = bad && bad !== 'INTACT';
          return '<div class="histitem">'
            + '<span class="htime">'+esc(f.timein||'')+'</span>'
            + '<div class="hmain">'
            +   '<div class="t1">PO '+esc(f.po)+'</div>'
            +   '<div class="t2">'+esc(f.carrier||'no carrier')
            +     (f.driver ? ' \u00b7 '+esc(f.driver) : '')+'</div>'
            + '</div>'
            + '<span class="hseal'+(bad?' bad':'')+'">'+esc(f.sealcond||'?')+'</span>'
            + '<div class="histbtns">'
            +   '<button class="hbtn" title="Email" aria-label="Email PO '+esc(f.po)+'"'
            +     ' onclick="emailHist('+r.i+')">\u2709</button>'
            +   '<button class="hbtn" title="Share" aria-label="Share PO '+esc(f.po)+'"'
            +     ' onclick="shareHist('+r.i+')">\u21e7</button>'
            +   '<button class="hbtn del" title="Delete" aria-label="Delete PO '+esc(f.po)+'"'
            +     ' onclick="delHist('+r.i+')">\u2715</button>'
            + '</div></div>';
        }).join('')
      + '</div>';
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
/* Rows written before the gate log stored ISO are converted as they are read.
   They cannot be corrected in place: the rules let an officer change only the
   time out and the outbound trailer, so the stored date stays as it was and is
   translated on the way in, every time. */
function logMigrate(rows){
  (rows || []).forEach(function(r){
    var d = isoDate(r && r.date);
    if(d) r.date = d;
  });
  return rows || [];
}
try{ var _lg0 = sget('gc_logs'); if(_lg0) DB.logs = logMigrate(JSON.parse(_lg0)); }catch(e){}
function logPersist(){ try{ sset('gc_logs', JSON.stringify(DB.logs.slice(0,400))); }catch(e){} }
function logId(d){ return (isoDate(d.datein)||isoToday())+'_'+(d.po||'')+'_'+(d.timein||''); }
function logAdd(d){
  var id = logId(d), date = isoDate(d.datein) || isoToday();
  /* re-sending must not duplicate, including over a row written under the old
     date format, whose id will not match the one built above */
  var dup = DB.logs.some(function(r){
    return r.id === id
      || (isoDate(r.date) === date
          && String(r.po||'') === String(d.po||'')
          && String(r.timein||'') === String(d.timein||''));
  });
  if(dup) return;
  DB.logs.unshift({
    id:id, ts:new Date().toISOString(),
    date:date,
    officer:(window.CLOUD&&CLOUD.user&&CLOUD.user.email)||'', officerName:getOfficerName(),
    po:d.po||'', timein:d.timein||'', appt:d.appt||'', trailer:d.trailer||'',
    carrier:d.carrier||'', tractor:d.tractor||'',
    timeout:'', outtrailer:''
  });
  logPersist();
  if(window.logCloudAdd) logCloudAdd(DB.logs[0]);
  if($('sec-log') && $('sec-log').classList.contains('on')) renderLog();
}
/* The sheet runs on past the end of a shift: a trailer that booked in on the
   morning may not leave until the evening, under a different officer. So the
   row records both hands - who took the time in, and who marked it out. */
function logSet(id,k,v){
  var r = DB.logs.filter(function(x){ return x.id===id; })[0];
  if(!r) return;
  var had = String(r.timeout||'').trim();
  r[k]=v;
  if(k==='timeout'){
    if(String(v||'').trim()){
      if(!had || !r.outBy){
        r.outBy = (window.CLOUD&&CLOUD.user&&CLOUD.user.email)||'';
        r.outByName = getOfficerName();
        r.outAt = new Date().toISOString();
      }
    } else { r.outBy=''; r.outByName=''; r.outAt=''; }
  }
  if(k==='timeout') logStampWho(id, r.outByName || r.outBy);
  logPersist();
  if(window.logCloudSet) logCloudSet(r);
}
/* Only the one cell is touched: re-drawing the whole sheet mid-keystroke would
   take the cursor away from the officer typing into it. */
function logStampWho(id, name){
  var host = $('logrows'); if(!host) return;
  var cells = host.querySelectorAll('td.lgout');
  for(var i=0;i<cells.length;i++){
    if(cells[i].getAttribute('data-row') !== id) continue;
    var who = String(name||'').trim().split('@')[0];
    if(who) cells[i].setAttribute('title', who + ' \u00b7 out');
    else cells[i].removeAttribute('title');
    return;
  }
}
/* The shift boundary the current sheet starts from: 06:00 and 18:00. Between
   midnight and 06:00 the officer is still on the evening shift that began at
   18:00 the day before. */
function logShiftStart(now){
  now = now || new Date();
  var h = now.getHours();
  var d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if(h < 6){ d.setDate(d.getDate() - 1); return { date: isoDate(_logISO(d)), min: 18*60 }; }
  return { date: isoDate(_logISO(d)), min: (h < 18) ? 6*60 : 18*60 };
}
function _logISO(d){
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')
    +'-'+String(d.getDate()).padStart(2,'0');
}
/* Where a row sits against the shift now on duty. */
function logInShift(r, start){
  var d = isoDate(r.date) || r.date;
  if(d > start.date) return true;
  if(d < start.date) return false;
  var m = (typeof anMin === 'function') ? anMin(r.timein) : null;
  return m == null ? true : m >= start.min;
}
/* Both hands are on the record; neither is printed on the sheet. The paper has
   no column for it, and two names under the times made the form unreadable.
   It sits on the cell, for anyone who needs to ask. */
function logWhoTitle(name, extra){
  name = String(name||'').trim();
  var who = name ? name.split('@')[0] : '';
  var t = [who, extra].filter(Boolean).join(' \u00b7 ');
  return t ? ' title="'+esc(t)+'"' : '';
}
function logToday(){
  var start = logShiftStart();
  /* order by Time In, which is what the officer reads, falling back to when the
     row was created. Two forms pushed in the same millisecond share a ts, so ts
     alone is not a reliable ordering. */
  function key(r){ return String(r.timein||'').padStart(4,'0') + '|' + (r.ts||''); }
  return DB.logs.filter(function(r){
      return logInShift(r, start) || !String(r.timeout||'').trim();
    })
    .slice().sort(function(a,b){
      var ai = logInShift(a, start), bi = logInShift(b, start);
      /* what the last shift left open sits on top: it is what needs finishing */
      if(ai !== bi) return ai ? 1 : -1;
      var ad = isoDate(a.date)||a.date, bd = isoDate(b.date)||b.date;
      if(ad !== bd) return ad < bd ? -1 : 1;
      return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
    });
}
var LOG_MIN_ROWS = 14;
function logCell(v){ return '<td class="logro">'+esc(v||'')+'</td>'; }
/* a labelled band across the sheet, telling the two blocks apart */
function logBand(text, cls){
  return '<tr class="logband '+cls+'"><td colspan="9">'+esc(text)+'</td></tr>';
}
/* who took this half of the row, in small print under the time */
function logWho(name, extra){
  name = String(name||'').trim();
  if(!name && !extra) return '';
  var who = name ? name.split('@')[0] : '';
  return '<span class="logwho">'+esc([extra, who].filter(Boolean).join(' · '))+'</span>';
}
/* A row that came from a seal verification form is that form's record, so only
   the closing fields are typed on it. A row the officer writes by hand - the
   bobtail that comes in with nothing and leaves with a trailer - is theirs to
   fill in from end to end. */
function logCellIn(id, k, v, extra){
  var more = (k==='carrier') ? suggestAttrs('carrier') : '';
  if(k==='timein' || k==='timeout') more += ' onclick="logStampTime(this)"';
  return '<td><input data-k="'+k+'" value="'+esc(v||'')+'"'+(extra||'')+more
    + ' oninput="logSet(\''+id+'\',\''+k+'\',this.value)"></td>';
}
var LOG_COLS = ['timein','timeout','outtrailer','carrier','tractor','trailer',
                'plate','state','notes'];

/* ---- suggestions, from the schedule the office already uploaded ----
   The officer never has to spell a vendor or a carrier the office has already
   typed. Free text still wins: this offers, it never insists, which is what
   aria-autocomplete="both" tells a screen reader. */
function suggestList(k){
  var seen = {}, out = [];
  DB.orders.forEach(function(o){
    var v = String(o[k]||'').trim();
    if(v && !seen[v.toUpperCase()]){ seen[v.toUpperCase()] = 1; out.push(v); }
  });
  return out.sort();
}
function suggestSync(){
  [['carrier','dl_carrier'], ['vendor','dl_vendor']].forEach(function(p){
    var el = $(p[1]); if(!el) return;
    var list = suggestList(p[0]);
    el.innerHTML = list.map(function(v){
      return '<option value="'+esc(v)+'"></option>'; }).join('');
  });
}
function suggestAttrs(kind){
  return ' list="dl_'+kind+'" autocomplete="off" aria-autocomplete="both"';
}
/* Tapping a time box stamps the time - the time the officer is standing there,
   which is the time they would have written. On click rather than on focus, so
   tabbing through the sheet does not stamp times nobody asked for, and so a
   stamp never lands in the middle of somebody typing. Already filled in is left
   alone: a stamp must never overwrite a reading. */
function logStampTime(el){
  if(!el || String(el.value||'').trim()) return;
  el.value = nowHHMM();
  el.dispatchEvent(new Event('input', { bubbles:true }));
}
/* A blank line on the sheet is a blank line on paper: write on it and it
   becomes a row. There is no button for it, because there is no button on
   the paper form either. */
function logBlankRow(){
  var UP = ' style="text-transform:uppercase"';
  return '<tr class="blank">' + LOG_COLS.map(function(k){
      var more = (k==='carrier') ? suggestAttrs('carrier') : '';
      if(k==='timein' || k==='timeout') more += ' onclick="logStampTime(this)"';
      return '<td><input data-k="'+k+'"'
        + (k==='timein'||k==='timeout' ? ' inputmode="numeric"' : (k==='notes'?'':UP))
        + more + ' oninput="logStartRow(\''+k+'\',this.value)"></td>';
    }).join('') + '<td></td></tr>';
}
function logStartRow(k, v){
  if(!String(v||'').trim()) return;
  var date = isoToday();
  var r = { id: date+'_hand_'+Date.now(), ts:new Date().toISOString(), date:date,
    manual:true,
    officer:(window.CLOUD&&CLOUD.user&&CLOUD.user.email)||'', officerName:getOfficerName(),
    po:'', timein:(k==='timein' ? v : nowHHMM()), appt:'', trailer:'', carrier:'',
    tractor:'', plate:'', state:'', notes:'', timeout:'', outtrailer:'' };
  r[k] = v;
  DB.logs.unshift(r);
  logPersist();
  if(window.logCloudAdd) logCloudAdd(r);
  renderLog();
  /* put the cursor back where the officer left it, at the end of what they typed */
  var el = document.querySelector('#logrows tr[data-row="'+r.id+'"] input[data-k="'+k+'"]');
  if(el){ el.focus(); try{ el.setSelectionRange(el.value.length, el.value.length); }catch(e){} }
}
function renderLog(){
  suggestSync();
  var rows = logToday();
  $('log_loc').textContent   = getLocation();
  $('log_shift').textContent = currentShift();
  $('log_guard').textContent = getOfficerName()
    || ((window.CLOUD&&CLOUD.user&&CLOUD.user.email||'').split('@')[0]) || '';
  $('log_date').textContent  = todayStr();
  var start = logShiftStart();
  var head = '<tr>'
    + '<th>Time In</th><th>Time Out</th><th>Out Trailer Number</th><th>Carrier Name</th>'
    + '<th>Tractor Number</th><th>Trailer Number</th><th>Plate Number</th><th>State</th><th>Notes</th>'
    + '</tr>';
  var carried = rows.filter(function(r){ return !logInShift(r, start); }).length;
  var UP = ' style="text-transform:uppercase"';
  var body = rows.map(function(r, i){
    var id = esc(r.id);
    var over = !logInShift(r, start);
    var mine = !!r.manual;
    var band = '';
    if(i === 0 && over)
      band = logBand('Left open by the shift before \u00b7 finish these first', 'carryband');
    if(carried && i === carried) band = logBand('This shift', 'shiftband');
    /* one class attribute: two of them and the browser keeps only the first */
    var cls = [over?'carried':'', mine?'hand':''].filter(Boolean).join(' ');
    return band + '<tr data-row="'+id+'"'+(cls?' class="'+cls+'"':'')+'>'
      + (mine
          ? logCellIn(id, 'timein', r.timein, ' inputmode="numeric"')
          : '<td class="logro"'+logWhoTitle(r.officerName || r.officer, 'in')+'>'
            + esc(r.timein||'') + logWho(over ? fmtDate(r.date) : '')+'</td>')
      + '<td class="lgout" data-row="'+id+'"'+logWhoTitle(r.outByName || r.outBy, 'out')+'>'
      +   '<input data-k="timeout" value="'+esc(r.timeout)+'" inputmode="numeric"'
      +   ' onclick="logStampTime(this)"'
      +   ' oninput="logSet(\''+id+'\',\'timeout\',this.value)"></td>'
      + '<td><input data-k="outtrailer" value="'+esc(r.outtrailer)+'"'+UP
      +   ' oninput="logSet(\''+id+'\',\'outtrailer\',this.value)"></td>'
      + (mine ? logCellIn(id, 'carrier', r.carrier, UP) : logCell(r.carrier))
      + (mine ? logCellIn(id, 'tractor', r.tractor, UP) : logCell(r.tractor))
      + (mine ? logCellIn(id, 'trailer', r.trailer, UP) : logCell(r.trailer))
      + logCellIn(id, 'plate', r.plate, UP)
      + logCellIn(id, 'state', r.state, UP)
      + logCellIn(id, 'notes', r.notes)
      + (mine ? '<td class="logdel"><button onclick="logDel(\''+id+'\')"'
                + ' aria-label="Remove this row">\u2715</button></td>' : '<td></td>')
      + '</tr>';
  }).join('');

  var blanks = Math.max(0, LOG_MIN_ROWS - rows.length);
  for (var i=0; i<blanks; i++) body += logBlankRow();
  $('logrows').innerHTML = '<div class="ycwrap"><table class="yct logt">'
    + head.replace('<th>Notes</th>', '<th>Notes</th><th style="min-width:34px"></th>')
    + body + '</table></div>';
}
function logDel(id){
  var r = DB.logs.filter(function(x){ return x.id===id; })[0];
  if(!r || !r.manual) return;
  if(!confirm('Remove this row from the gate log?')) return;
  DB.logs = DB.logs.filter(function(x){ return x.id!==id; });
  logPersist();
  if(window.logCloudDel) logCloudDel(id);
  renderLog();
}


/* ======================= boot ======================= */
buildChoices(); stat(); doSearch(); resetForm(false);
try{ formDraftRestore(); }catch(e){}
(function(){ var s=$('sec-form'); if(!s) return;
  s.addEventListener('input', function(){
    if(window.invalidatePreview) invalidatePreview();
    checkSeal(); formDraftSave(); markAllMissing();
  }, true);
  s.addEventListener('change', function(){ checkSeal(); formDraftSave(); }, true);
})();

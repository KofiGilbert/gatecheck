/* Gate Check — https://gatecheck-martinbrower.netlify.app */

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
function go(name){
  ['search','sched','form','hist','yard','settings'].forEach(function(n){
    var s=$('sec-'+n); if(s) s.classList.toggle('on', n===name);
    var b=$('nav-'+n); if(b) b.classList.toggle('on', n===name);
  });
  if(name==='sched') renderSched();
  if(name==='hist') renderHist();
  if(name==='form') sigInit();
  if(name==='settings'){ var i=$('set_offname'); if(i) i.value=getOfficerName(); }
  if(name==='yard'){ renderYard(); renderYardHist(); }
  window.scrollTo(0,0);
}
function toggle(id){ var e=$(id); e.style.display = e.style.display==='none'?'block':'none'; }
function stat(){
  var dates = {}; DB.orders.forEach(function(o){ dates[o.date]=1; });
  var ds = Object.keys(dates).sort();
  $('datastat').textContent = DB.orders.length
    ? DB.orders.length+' orders loaded • '+ds.map(function(d){return fmtDate(d).replace(/ \d{4}$/,'');}).join('  |  ')
    : 'No schedule loaded yet — go to Schedule tab';
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
  var rows=[],row=[],cur='',inQ=false;
  for(var i=0;i<text.length;i++){
    var ch=text[i];
    if(inQ){ if(ch==='"'){ if(text[i+1]==='"'){cur+='"';i++;} else inQ=false; } else cur+=ch; }
    else if(ch==='"') inQ=true;
    else if(ch===','){ row.push(cur); cur=''; }
    else if(ch==='\n'||ch==='\r'){ if(cur!==''||row.length){row.push(cur);rows.push(row);row=[];cur='';} }
    else cur+=ch;
  }
  if(cur!==''||row.length){row.push(cur);rows.push(row);}
  if(!rows.length) return [];
  var hdr = rows[0].map(function(h){return h.trim().toLowerCase().replace(/\s+/g,'_');});
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
  mergeOrders(arr);
}
$('file').addEventListener('change', function(){
  var f=this.files[0]; if(!f) return;
  var name = (f.name||'').toLowerCase();
  if(f.type.indexOf('image')===0 || /\.(jpe?g|png|heic|webp)$/.test(name)){
    importPhoto(f);
  } else if(/\.(xlsx|xlsm)$/.test(name)){
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
    + '<div class="kv"><span class="k">Carrier</span><span class="v">'+esc(o.carrier||'—')+'</span></div>'
    + '<div class="kv"><span class="k">Contact</span><span class="v">'+esc(o.contact||'—')+'</span></div>'
    + '<div class="kv"><span class="k">Open Cases</span><span class="v">'+o.cases.toLocaleString()+'</span></div>'
    + '<div class="kv"><span class="k">Pallets</span><span class="v">'+o.pallets+'</span></div>'
    + '<div class="kv"><span class="k">In Yard</span><span class="v">'+esc(o.in_yard||'—')+'</span></div>'
    + (withBtn?'<button class="btn" onclick="fillFromOrder(\''+esc(o.order)+'\',\''+esc(o.date)+'\')">📝 Fill Seal Form</button>':'')
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
    return '<div class="schedday">'+fmtDate(d)+' — '+bydate[d].length+' orders</div>'+rows;
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
  $('formsrc').innerHTML = 'Auto-filled from order <b>'+esc(o.order)+'</b> — '+esc(o.vendor)
    +' ('+esc(fmtDate(o.date))+', '+esc(o.detail)+' '+esc(o.time)+')';
  go('form'); toast('Form filled from order '+o.order);
}
function resetForm(msg){
  ['f_datein','f_timein','f_appt','f_po','f_trailer','f_carrier','f_vendor','f_initials',
   'f_driver','f_sealtrailer','f_sealbol','f_reefset','f_reefact','f_verified']
   .forEach(function(id){ $(id).value=''; });
  $('f_photoid').checked=false; $('f_locked').checked=false;
  setPick('sealtype',null); setPick('sealcond',null); setPick('fuel',null);
  clearSig();
  $('f_datein').value = todayStr(); $('f_timein').value = nowHHMM();
  var pm=$('f_pomode'); if(pm){ pm.value='po'; $('f_po').disabled=false; }
  $('f_verified').value = getOfficerName();
  var ac=$('actions'); if(ac) ac.style.display='none';
  $('formsrc').textContent = 'Not linked to an order — search an order and tap "Fill Seal Form" to auto-populate.';
  $('preview').innerHTML='';
  if(msg) toast('New blank form');
}

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
    txt('Vendor: '+(d.vendor||'—')+'    ·    Generated by Gate Check '
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
        toast('Image downloaded — attach it to your email');
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
(function(){ var i=$('set_offname'); if(!i) return;
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
      else toast('⚠️ Send failed'+((j&&j.error)?': '+j.error:'')+' — use "Share another way"');
    })
    .catch(function(){ toast('⚠️ Could not confirm the send — check with the office before re-sending, or use "Share another way"'); });
  });
}
(function(){ var m=document.getElementById('set_mailer'); if(!m) return;
  m.addEventListener('input', function(){ sset('gc_mailer', m.value.trim()); }); })();
function emailData(d){
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
        +'\nSeal: '+(d.sealcond||'-')+' ('+(d.sealtype||'-')+') #'+(d.sealtrailer||'-')+'\n\n'
        +(copied? 'The completed form image is on the clipboard - paste it here (Cmd/Ctrl+V).'
                : 'The completed form image was downloaded - please attach it.'));
      var cc=getCcEmails().replace(/\s+/g,'');
      location.href='mailto:'+to+'?'+(cc?'cc='+encodeURIComponent(cc)+'&':'')+'subject='+sub+'&body='+body;
      toast(copied? '📋 Form image copied — paste it into the email (Cmd/Ctrl+V)'
                  : '⬇ Form image downloaded — attach it to the email');
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
    toast('Set the receiving office email first — Settings (⚙ top-right)');
    go('settings'); return; }
  emailData(d);
}
function emailHist(i){
  if(!getMailerUrl() && !getOfficeEmail()){
    toast('Set the receiving office email first — Settings (⚙ top-right)'); return; }
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
      +'<div class="t1">PO '+esc(f.po)+' — '+esc(f.driver||'no name')+'</div>'
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

/* ======================= boot ======================= */
buildChoices(); stat(); doSearch(); resetForm(false);
(function(){ var s=$('sec-form'); if(s) s.addEventListener('input', function(){
  if(window.invalidatePreview) invalidatePreview(); }, true); })();

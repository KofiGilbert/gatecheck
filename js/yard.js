/* Gate Check — https://gatecheck-martinbrower.netlify.app */

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
    if(type==='FROZEN' && t >= 0.05) reasons.push('TEMP OUT OF RANGE — frozen must be 0.0° or less');
    if(type==='COOLER' && (t < 33.95 || t > 40.05)) reasons.push('TEMP OUT OF RANGE — cooler must be 34.0°–40.0°');
  }
  if(row.fuel==='1/4' || row.fuel==='E') reasons.push('LOW FUEL — ¼ tank or less');
  return reasons;
}

/* ---------- UI (grid layout matching the printed log) ---------- */
function renderYard(){
  if(!YC) ycLoadDraft();
  $('yc_date').value = YC.date; $('yc_time').value = YC.time;
  $('yc_name').value = YC.name || getOfficerName();
  var host = $('ycrows');
  if(!YC.rows.length){
    host.innerHTML = '<div class="empty">No trailers yet — import a photo of the log, tap "Add trailer", or copy the last check.</div>';
    ycSummary(); return;
  }
  var head = '<tr><th style="min-width:96px">Trailer#</th><th style="min-width:104px">Product</th>'
    +'<th style="min-width:88px">Temp Set Point</th><th style="min-width:88px">Temp</th>'
    +'<th style="min-width:76px">Fuel</th><th style="min-width:64px">Intact (Y/N)</th>'
    +'<th style="min-width:66px">Door #</th><th style="min-width:235px">*Escalate* — Action (if any was taken)</th><th></th></tr>';
  host.innerHTML = '<div class="ycwrap"><table class="yct">'+head
    + YC.rows.map(function(r,i){ return ycRowHTML(r,i); }).join('')
    + '</table></div>'
    + '<div class="hint" style="margin-top:6px">Type <b>DEF</b> in Set Point or Temp when the unit shows defrost. Temps must be to the tenth (e.g. -10.0).</div>';
  YC.rows.forEach(function(r,i){ ycBanner(i); });
  ycSummary();
}
function ycSelHTML(i,k,list,cur){
  return '<select onchange="ycSet('+i+',\''+k+'\',this.value,true)"><option value=""></option>'
    + list.map(function(v){ return '<option '+(cur===v?'selected':'')+'>'+v+'</option>'; }).join('')+'</select>';
}
function ycRowHTML(r,i){
  return '<tr id="ycr'+i+'">'
    +'<td><input style="font-weight:800;text-transform:uppercase" placeholder="LR7524" value="'+esc(r.trailer)+'" oninput="ycSet('+i+',\'trailer\',this.value,true)"></td>'
    +'<td><input style="text-transform:uppercase" placeholder="FRIES" value="'+esc(r.product)+'" oninput="ycSet('+i+',\'product\',this.value,true)"></td>'
    +'<td><input placeholder="-10.0 / DEF" value="'+esc(r.set)+'" oninput="ycSet('+i+',\'set\',this.value,true)" onblur="ycBlurSet('+i+',this)"></td>'
    +'<td><input placeholder="-9.9 / DEF" value="'+esc(r.temp)+'" oninput="ycSet('+i+',\'temp\',this.value,true)" onblur="ycBlurTemp('+i+',this)"></td>'
    +'<td>'+ycSelHTML(i,'fuel',YC_FUELS,r.fuel)+'</td>'
    +'<td>'+ycSelHTML(i,'intact',['Y','N'],r.intact)+'</td>'
    +'<td><input placeholder="N/A" value="'+esc(r.door)+'" oninput="ycSet('+i+',\'door\',this.value,true)"></td>'
    +'<td id="ycb'+i+'"></td>'
    +'<td><button class="delx" onclick="ycDel('+i+')">✕</button></td>'
    +'</tr>';
}
function ycBanner(i){
  var r = YC.rows[i], el = $('ycb'+i), tr = $('ycr'+i); if(!el) return;
  var reasons = ycEval(r);
  if(tr) tr.classList.toggle('esc', reasons.length>0);
  if(reasons.length){
    el.innerHTML = '<div class="escmsg">🚨 *ESCALATE* — '+reasons.map(esc).join(' · ')+'</div>'
      +'<input style="font-size:13.5px" placeholder="Action taken…" value="'+esc(r.action)+'" oninput="ycSet('+i+',\'action\',this.value,true)">';
  } else if(r.temp && (ycIsTenth(r.temp) || String(r.temp).toUpperCase()==='DEF')){
    el.innerHTML = '<div class="okmsg">N/A — in range ✓</div>';
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
    toast('Temp must be recorded to the tenth — e.g. '+(ycIsNumLoose(v)? v+'.0 (if that is the true reading)':'-10.0'));
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
  toast('Copied '+YC.rows.length+' trailers from the last check — enter fresh temps');
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
  YC.name = $('yc_name').value.trim(); YC.date = $('yc_date').value; YC.time = $('yc_time').value;
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
      var reason = r.escalate.map(function(x){ return x.split(' — ')[0]; }).join(', ');
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
  txt('Generated by Gate Check · '+new Date(d.ts).toLocaleString(),637,1600,18,false,true,true,'#666');
  done(cv);
}
function ycFileName(d){ return 'YardCheck_'+(d.date||'').replace(/-/g,'')+'_'+(d.time||'')+'.png'; }

/* ---------- save / email / share ---------- */
function ycSave(){
  var d = ycData();
  if(window.CLOUD && CLOUD.ready){
    d.createdBy = CLOUD.user.email;
    CLOUD.db.collection('yardchecks').add(d).catch(function(e){ toast('Could not save: '+e.message); });
    toast('Yard check saved ✔ — visible to the whole team');
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
        : '⚠️ Send failed'+((j&&j.error)?': '+j.error:'')+' — use Share'); })
      .catch(function(){ toast('⚠️ Could not confirm the send — check with the office, or use Share'); });
    } else {
      cv.toBlob(function(blob){
        var f=new File([blob], ycFileName(d), {type:'image/png'});
        if(navigator.canShare && navigator.canShare({files:[f]}))
          navigator.share({files:[f], title:'Yard Check '+ycFmtDate(d.date)+' '+d.time}).catch(function(){});
        else { var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=ycFileName(d); a.click();
          toast('Image downloaded — attach it to your email'); }
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
  var el=$('ychist'); if(!el) return;
  if(!DB.yardchecks.length){ el.innerHTML='<div class="empty">No saved yard checks yet.</div>'; return; }
  el.innerHTML = DB.yardchecks.map(function(y,i){
    var esc_n=(y.rows||[]).filter(function(r){return (r.escalate||[]).length;}).length;
    return '<div class="histitem"><div>'
      +'<div class="t1">'+esc(ycFmtDate(y.date))+' · '+esc(y.time)+' — '+esc(y.name||'')+'</div>'
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
/* meta field bindings */
(function(){
  ['yc_date','yc_time','yc_name'].forEach(function(id){
    var e=$(id); if(!e) return;
    e.addEventListener('change', function(){
      if(!YC) return;
      YC.date=$('yc_date').value; YC.time=$('yc_time').value; YC.name=$('yc_name').value.trim();
      ycSaveDraft(); invalidateYcPreview();
    });
  });
})();

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
      toast('Could not find a trailer list in that photo — try flatter and sharper'); return;
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
    if(!rows.length){ toast('No trailers recognized — try a flatter photo, or add rows by hand'); return; }
    if(YC.rows.length && !confirm('Replace the current '+YC.rows.length+' trailer(s) with the '
        +rows.length+' found in the photo?')) return;
    YC.rows = rows;
    ycSaveDraft(); renderYard();
    toast('📷 Found '+rows.length+' trailers — check the list, then enter temps, fuel and the rest');
  }catch(e){
    ocrStatus(null);
    toast('Photo reading failed: '+(e.message||e)+' — add trailers by hand');
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

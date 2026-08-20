/* Checkpoint · https://gatecheck-martinbrower.netlify.app */

/* =================== v2: XLSX import =================== */
function colToIdx(ref){ // "BC12" -> 54
  var m = ref.match(/^([A-Z]+)/); if(!m) return 0;
  var n=0; for(var i=0;i<m[1].length;i++) n = n*26 + (m[1].charCodeAt(i)-64);
  return n-1;
}
function serialToISO(n){
  var ms = Math.round((n - 25569) * 86400 * 1000);
  var d = new Date(ms);
  return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0');
}
function importXlsx(buf){
  var files = fflate.unzipSync(new Uint8Array(buf));
  var dec = new TextDecoder();
  function xml(name){ return files[name]? new DOMParser().parseFromString(dec.decode(files[name]),'application/xml'):null; }
  // shared strings
  var shared=[], ss=xml('xl/sharedStrings.xml');
  if(ss){ var sis=ss.getElementsByTagName('si');
    for(var i=0;i<sis.length;i++) shared.push(sis[i].textContent); }
  var sheetNames = Object.keys(files).filter(function(k){ return /^xl\/worksheets\/sheet\d+\.xml$/.test(k); }).sort();
  var all=[], parsedAny=false;
  sheetNames.forEach(function(sn){
    var doc = xml(sn); if(!doc) return;
    var rows=[], rEls=doc.getElementsByTagName('row');
    for(var i=0;i<rEls.length;i++){
      var cells=[], cEls=rEls[i].getElementsByTagName('c');
      for(var j=0;j<cEls.length;j++){
        var c=cEls[j], ref=c.getAttribute('r')||'', t=c.getAttribute('t'), v='';
        var vEl=c.getElementsByTagName('v')[0];
        if(t==='inlineStr'){ v=c.textContent; }
        else if(vEl){ v = t==='s' ? (shared[+vEl.textContent]||'') : vEl.textContent; }
        cells[colToIdx(ref)] = v;
      }
      rows.push(cells);
    }
    // find header row: needs "order number" AND "vendor"
    var hi=-1, map={};
    for(var r=0;r<Math.min(rows.length,12);r++){
      var low=(rows[r]||[]).map(function(x){return String(x||'').toLowerCase().trim();});
      if(low.some(function(x){return x.indexOf('order number')>=0;}) &&
         low.some(function(x){return x.indexOf('vendor')>=0;})){
        hi=r;
        low.forEach(function(h,ci){
          if(!h) return;
          if(h.indexOf('date')>=0) map.date=ci;
          else if(h.indexOf('zone')>=0) map.zone=ci;
          else if(h.indexOf('priority')>=0||h.indexOf('★')>=0) map.priority=ci;
          else if(h.indexOf('detail')>=0) map.detail=ci;
          else if(h==='time'||h.indexOf('time')===0) map.time=ci;
          else if(h.indexOf('yard')>=0) map.in_yard=ci;
          else if(h.indexOf('order')>=0) map.order=ci;
          else if(h.indexOf('vendor')>=0) map.vendor=ci;
          else if(h.indexOf('carrier')>=0) map.carrier=ci;
          else if(h.indexOf('contact')>=0) map.contact=ci;
          else if(h.indexOf('case')>=0) map.cases=ci;
          else if(h.indexOf('pallet')>=0) map.pallets=ci;
        });
        break;
      }
    }
    if(hi<0) return;
    parsedAny=true;
    for(var r2=hi+1;r2<rows.length;r2++){
      var row=rows[r2]||[];
      function gv(k){ return map[k]==null? '' : (row[map[k]]!=null? row[map[k]] : ''); }
      var ord = String(gv('order')).replace(/\D/g,'');
      if(!/^80\d{5,6}$/.test(ord)) continue;
      var dt = String(gv('date'));
      if(/^\d+(\.\d+)?$/.test(dt) && +dt>40000 && +dt<60000) dt = serialToISO(+dt);
      all.push({date:dt, zone:gv('zone'), priority:String(gv('priority')).trim()?'*':'',
        detail:gv('detail'), time:gv('time'), in_yard:gv('in_yard')||'N', order:ord,
        vendor:gv('vendor'), carrier:gv('carrier'), contact:gv('contact'),
        cases:+String(gv('cases')).replace(/\D/g,'')||0,
        pallets:+String(gv('pallets')).replace(/\D/g,'')||0});
    }
  });
  if(!all.length){ toast(parsedAny? 'Spreadsheet read, but no order rows found':'No "Order Number" sheet found in that file'); return; }
  mergeOrders(all);
}

/* =================== v2: photo OCR =================== */
var CARRIERS = ['MCD-ARMADA TRANSPORT','FREEDOM TRANS','PETERSON FARMS','MW LOGISTICS','SUNSET TRANS',
  'CH ROBINSON','TAYLOR FARMS','ARNOLD BROS','STONE ARCH','CASTELLINI','HIRSCHBACH','DAY & ROSS','DAY&ROSS',
  'K&B TRANS','KB TRANS','BAY & BAY','BAY&BAY','CFA - ARMADA','CFA-ARMADA','STEVENS','GENEVA','MARTEN',
  'KOTTKE','FEDEX','ROEHL','PRIME','TBROS','QUED','POPE','CEI','VRL','J&L','J & L','KB'];
function normTok(s){ return String(s).toUpperCase().replace(/[^A-Z0-9]/g,''); }
var CARRIERS_N = CARRIERS.map(function(c){ return {raw:c, n:normTok(c)}; })
  .sort(function(a,b){ return b.n.length-a.n.length; });

function ocrStatus(msg){
  var e=$('ocrstatus');
  if(msg===null){ e.style.display='none'; return; }
  e.style.display='block'; e.innerHTML=msg;
}
function loadImageFile(file){
  return new Promise(function(res,rej){
    var url=URL.createObjectURL(file), im=new Image();
    im.onload=function(){ res(im); }; im.onerror=rej; im.src=url;
  });
}
function drawToCanvas(im, maxSide, rotDeg){
  var w=im.width||im.videoWidth, h=im.height;
  var sc=Math.min(3, maxSide/Math.max(w,h));
  var dw=Math.round(w*sc), dh=Math.round(h*sc);
  var cv=document.createElement('canvas');
  if(rotDeg===90||rotDeg===270){ cv.width=dh; cv.height=dw; } else { cv.width=dw; cv.height=dh; }
  var g=cv.getContext('2d');
  g.imageSmoothingEnabled=true; g.imageSmoothingQuality='high';
  g.save(); g.translate(cv.width/2, cv.height/2); g.rotate(rotDeg*Math.PI/180);
  g.drawImage(im,-dw/2,-dh/2,dw,dh); g.restore();
  return cv;
}
/* grayscale -> flatten illumination -> adaptive threshold (integral images) */
function preprocess(cv){
  var w=cv.width,h=cv.height,g=cv.getContext('2d');
  var img=g.getImageData(0,0,w,h),d=img.data,n=w*h;
  var gray=new Float32Array(n);
  for(var i=0,p=0;i<n;i++,p+=4) gray[i]=0.299*d[p]+0.587*d[p+1]+0.114*d[p+2];
  var W=w+1;
  var I=new Float64Array(W*(h+1));
  function buildIntegral(src){
    for(var y=0;y<h;y++){ var rs=0, off=y*w, o2=(y+1)*W;
      for(var x=0;x<w;x++){ rs+=src[off+x]; I[o2+x+1]=I[o2-W+x+1]+rs; } }
  }
  function mean(x,y,r){
    var x1=Math.max(0,x-r),y1=Math.max(0,y-r),x2=Math.min(w-1,x+r),y2=Math.min(h-1,y+r);
    var a=(x2-x1+1)*(y2-y1+1);
    return (I[(y2+1)*W+x2+1]-I[y1*W+x2+1]-I[(y2+1)*W+x1]+I[y1*W+x1])/a;
  }
  buildIntegral(gray);
  var R1=Math.max(24,Math.round(Math.min(w,h)/26));
  var norm=new Float32Array(n);
  for(var y=0;y<h;y++) for(var x=0;x<w;x++){
    var m=mean(x,y,R1)||1; var v=gray[y*w+x]/m*255; norm[y*w+x]=v>255?255:v;
  }
  I.fill(0); buildIntegral(norm);
  var R2=Math.max(12,Math.round(Math.min(w,h)/64)), C=12;
  for(var y2=0;y2<h;y2++) for(var x2=0;x2<w;x2++){
    var t=mean(x2,y2,R2)-C;
    var bin=norm[y2*w+x2]>t?255:0;
    var p2=(y2*w+x2)*4; d[p2]=d[p2+1]=d[p2+2]=bin; d[p2+3]=255;
  }
  g.putImageData(img,0,0);
  return cv;
}
function countOrders(text){
  var m=text.match(/\b80\d{5}\b/g)||[]; var u={}; m.forEach(function(x){u[x]=1;});
  return Object.keys(u).length;
}
var _tessWorker=null;
async function getWorker(){
  if(_tessWorker) return _tessWorker;
  if(typeof Tesseract==='undefined') throw new Error('OCR engine not available');
  ocrStatus('⏳ Starting the photo reader…');
  /* engine files are served from this site's /vendor folder — no external CDN */
  var base = location.origin + location.pathname.replace(/[^\/]*$/, '');
  _tessWorker = await Tesseract.createWorker('eng', 1, {
    workerPath: base + 'vendor/worker.min.js',
    corePath:   base + 'vendor/tesseract-core-lstm.wasm.js',
    langPath:   base + 'vendor',
    gzip: true,
    workerBlobURL: false,
    cacheMethod: 'none',
    logger:function(m){ if(m.status==='recognizing text')
      ocrStatus('🔎 Reading photo… '+Math.round(m.progress*100)+'%'); }
  });
  await _tessWorker.setParameters({tessedit_pageseg_mode:'6'});
  return _tessWorker;
}
async function importPhoto(file){
  try{
    ocrStatus('📷 Preparing photo…');
    var im = await loadImageFile(file);
    var worker = await getWorker();
    // orientation: quick pass on small versions of each rotation
    var bestRot=0,bestCnt=-1,bestSmallText='';
    for(var k=0;k<4;k++){
      var rot=k*90;
      ocrStatus('🧭 Checking orientation '+(k+1)+'/4…');
      var small=preprocess(drawToCanvas(im,1800,rot));
      var res=await worker.recognize(small);
      var c=countOrders(res.data.text);
      if(c>bestCnt){ bestCnt=c; bestRot=rot; bestSmallText=res.data.text; }
      if(c>=5) break; // clearly right already
    }
    if(bestCnt<1){
      ocrStatus(null);
      toast('Could not find any order numbers in that photo. Try a flatter, sharper shot, or import the .xlsx/.json file.');
      return;
    }
    ocrStatus('🔎 Reading photo at full quality…');
    var big=preprocess(drawToCanvas(im,2600,bestRot));
    var res2=await worker.recognize(big);
    ocrStatus(null);
    var parsed=parseOcr(res2.data.text);
    // add extra rows the quick pass caught, but skip one-digit-off near-duplicates (misreads)
    var extra=parseOcr(bestSmallText);
    function near(a,b){ if(a.length!==b.length) return false; var d=0;
      for(var q=0;q<a.length;q++) if(a[q]!==b[q]) d++; return d<=1; }
    var have=parsed.rows.map(function(r){return r.order;});
    extra.rows.forEach(function(r){
      if(!have.some(function(h){return near(h,r.order);})){ parsed.rows.push(r); have.push(r.order); }
    });
    if(!parsed.date) parsed.date=extra.date;
    if(!parsed.rows.length){
      toast('No order rows recognized. Try a sharper photo or the .xlsx/.json file.'); return;
    }
    openReview(parsed);
  }catch(e){
    ocrStatus(null);
    toast('Photo reading failed: '+(e.message||e)+'. Use the .xlsx or .json file instead.');
  }
}
var MONTHS={JANUARY:1,FEBRUARY:2,MARCH:3,APRIL:4,MAY:5,JUNE:6,JULY:7,AUGUST:8,SEPTEMBER:9,OCTOBER:10,NOVEMBER:11,DECEMBER:12};
function parseOcr(text){
  var lines=text.split(/\n/), rows=[], date='';
  // date in header
  var dm=text.match(/(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s*(\d{1,2})\s*[,.]?\s*(\d{4})/i);
  if(dm) date=dm[3]+'-'+String(MONTHS[dm[1].toUpperCase()]).padStart(2,'0')+'-'+String(+dm[2]).padStart(2,'0');
  lines.forEach(function(line){
    var m=line.match(/\b(80\d{5})\b/);
    if(!m) return;
    var order=m[1], left=line.slice(0,m.index), right=line.slice(m.index+m[1].length);
    // detail
    var detail = /RO?P|DRO\b/i.test(left)?'DROP':(/[LU][IUV]?V?E|LIV|\bVE\b|\bUE\b|\bLE\b/i.test(left)?'LIVE':'');
    var star = /[*&®#★]/.test(left)?'*':'';
    // zone: last standalone D/F/R/O token, else first letter of first word
    var zone='', toks=left.trim().split(/\s+/);
    toks.forEach(function(t){ var c=t.replace(/[^A-Za-z0-9]/g,'');
      if(/^[DFRO0]$/i.test(c)) zone=c.toUpperCase(); });
    if(!zone){ for(var i=0;i<toks.length;i++){ var f=toks[i].charAt(0).toUpperCase();
      if('DFR'.indexOf(f)>=0){ zone=f; break; } } }
    if(zone==='O'||zone==='0') zone='D';
    // time: last 3-4 digit group in left
    var tm=left.match(/\b\d{3,4}\b/g);
    var time=tm? tm[tm.length-1]:'???';
    // right side: strip junk, pull trailing numbers
    var rt=right.replace(/^[\s._\-=~,:;|\\\/]+/,'').trim();
    var rtoks=rt.split(/\s+/).filter(function(t){ return !/^[|\\\/.,:;\-—_~'"()\[\]{}<>«»•]+$/.test(t); });
    function numClean(t){
      var s=t.replace(/[Oo]/g,'0').replace(/[lI]/g,'1').replace(/s/g,'5').replace(/S/g,'5')
             .replace(/\$/g,'9').replace(/v/g,'1').replace(/[^\d]/g,'');
      return s;
    }
    var nums=[];
    while(rtoks.length && nums.length<2){
      var lastTok=rtoks[rtoks.length-1], cl=numClean(lastTok);
      if(cl.length && cl.length<=6 && /\d/.test(lastTok.replace(/[OoIlsSv$]/g,'0'))
         && lastTok.replace(/[^A-Za-z]/g,'').length<=2){
        nums.unshift(cl); rtoks.pop();
      } else break;
    }
    var pallets = nums.length? +nums[nums.length-1]:0;
    var cases = nums.length>1? +nums[0]:0;
    if(pallets>99 && !cases){ cases=pallets; pallets=0; }
    // contact: CFA-ARMADA at end
    var contact='';
    var tailN=normTok(rtoks.slice(-2).join(''));
    if(/CFA0?ARMADA$|CFAARMADA$/.test(tailN)){
      contact='CFA - ARMADA';
      // remove the matched tokens
      var need='CFAARMADA';
      while(rtoks.length && need.length){
        var t2=normTok(rtoks[rtoks.length-1]);
        if(need.slice(-t2.length)===t2){ need=need.slice(0,-t2.length); rtoks.pop(); }
        else break;
      }
    }
    // carrier: try suffix windows of 1..3 tokens against lexicon
    var carrier='';
    outer:
    for(var wsz=3;wsz>=1;wsz--){
      if(rtoks.length<wsz) continue;
      var cand=normTok(rtoks.slice(-wsz).join(''));
      if(!cand) continue;
      for(var ci=0;ci<CARRIERS_N.length;ci++){
        if(CARRIERS_N[ci].n===cand){
          carrier=CARRIERS_N[ci].raw; rtoks.length=rtoks.length-wsz; break outer;
        }
      }
    }
    var vendor=rtoks.join(' ').replace(/\s{2,}/g,' ').replace(/[|\\_=~]+/g,'').trim();
    rows.push({date:date, zone:zone, priority:star, detail:detail||'LIVE', time:time,
      in_yard:'N', order:order, vendor:vendor, carrier:carrier, contact:contact,
      cases:cases, pallets:pallets});
  });
  // de-dup same order keeping first
  var seen={}, out=[];
  rows.forEach(function(r){ if(!seen[r.order]){ seen[r.order]=1; out.push(r); } });
  return {date:date, rows:out};
}

/* =================== v2: review UI =================== */
var REV=null;
function openReview(parsed){
  REV=parsed;
  $('revdate').value = parsed.date || new Date().toISOString().slice(0,10);
  $('revmsg').innerHTML = 'The photo reader found <b>'+parsed.rows.length+' orders</b>'
    +(parsed.date? ' for <b>'+esc(fmtDate(parsed.date))+'</b>':'')
    +'. <b>Compare with the paper sheet</b>, because a blurry photo can miss rows or misread cases/pallets. '
    +'Tap any box to fix it, ✕ to remove a row. Missing rows? Cancel and retake the photo flatter, '
    +'or import the .xlsx/.json instead.';
  $('revrows').innerHTML = parsed.rows.map(function(r,i){
    return '<div class="card" style="padding:10px;margin-bottom:8px" id="rev'+i+'">'
      +'<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">'
      +'<input style="flex:2;font-weight:800" value="'+esc(r.order)+'" data-k="order">'
      +'<input style="flex:1" value="'+esc(r.zone)+'" data-k="zone" placeholder="Zone">'
      +'<input style="flex:1.4" value="'+esc(r.detail)+'" data-k="detail" placeholder="LIVE/DROP">'
      +'<input style="flex:1" value="'+esc(r.time)+'" data-k="time" placeholder="Time">'
      +'<button class="btn red" style="width:auto;margin:0;padding:8px 11px" onclick="delReview('+i+')">✕</button></div>'
      +'<input style="margin-bottom:6px" value="'+esc(r.vendor)+'" data-k="vendor" placeholder="Vendor">'
      +'<div style="display:flex;gap:6px">'
      +'<input style="flex:2" value="'+esc(r.carrier)+'" data-k="carrier" placeholder="Carrier">'
      +'<input style="flex:1" value="'+(r.cases||'')+'" data-k="cases" placeholder="Cases" inputmode="numeric">'
      +'<input style="flex:1" value="'+(r.pallets||'')+'" data-k="pallets" placeholder="Pallets" inputmode="numeric">'
      +'</div></div>';
  }).join('');
  $('review').style.display='block';
  window.scrollTo(0,0);
}
function delReview(i){ REV.rows[i]=null; var e=$('rev'+i); if(e) e.remove(); }
function closeReview(){ $('review').style.display='none'; REV=null; }
function confirmReview(){
  if(!REV) return;
  var date=$('revdate').value;
  if(!date){ toast('Pick the schedule date first'); return; }
  var out=[];
  REV.rows.forEach(function(r,i){
    if(!r) return;
    var e=$('rev'+i); if(!e) return;
    var v={date:date, in_yard:'N', priority:r.priority, contact:r.contact};
    e.querySelectorAll('input[data-k]').forEach(function(inp){ v[inp.getAttribute('data-k')]=inp.value.trim(); });
    if(!/^80\d{5,6}$/.test(String(v.order).replace(/\D/g,''))) return;
    v.order=String(v.order).replace(/\D/g,'');
    out.push(v);
  });
  if(!out.length){ toast('No valid rows to add'); return; }
  closeReview();
  mergeOrders(out);
  go('search');
}

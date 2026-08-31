/* ===================== Daily Activity Report =====================
   The officer should not be writing this out at the end of a shift. The app
   watched the whole shift, so it drafts the report and the officer reads it,
   corrects anything it got wrong, and signs it off.

   Every line is composed from two things already on the record:
     the yard checks filed  (DB.yardchecks)
     the gate log           (DB.logs, time in and time out)

   Nothing is invented. An hour with nothing on the record reads "All Clear."
*/

var DAR_AM = 6, DAR_PM = 18;           /* the two shifts start at 6 and at 18 */
var DAR = null;                         /* the draft being read */

function darHour(h){
  var x = ((h % 24) + 24) % 24;
  var ap = x < 12 ? 'am' : 'pm';
  var n = x % 12; if(!n) n = 12;
  return n + ap;
}
function darShiftLabel(start){ return start === DAR_AM ? 'morning' : 'evening'; }
function darShiftHours(start){ return '6am – 6pm'.replace('6am', darHour(start))
  .replace('6pm', darHour(start + 12)); }

/* which shift the officer is on now, and the date it belongs to */
function darCurrent(now){
  now = now || new Date();
  var h = now.getHours();
  var d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if(h >= DAR_AM && h < DAR_PM) return { start: DAR_AM, date: isoDate(_darISO(d)) };
  /* before 6am the officer is still on the evening shift that began yesterday */
  if(h < DAR_AM) d.setDate(d.getDate() - 1);
  return { start: DAR_PM, date: isoDate(_darISO(d)) };
}
function _darISO(d){
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')
    +'-'+String(d.getDate()).padStart(2,'0');
}
function darMin(t){
  var s = String(t == null ? '' : t).replace(/[^0-9]/g, '');
  if(!s || s.length > 4) return null;
  var n = parseInt(s, 10); if(isNaN(n)) return null;
  var h = s.length <= 2 ? n : Math.floor(n / 100);
  var m = s.length <= 2 ? 0 : n % 100;
  return (h > 23 || m > 59) ? null : h * 60 + m;
}

/* ---- what the record says happened in one hour of one shift ---- */
function darActivity(date, start, hour){
  var onNext = hour < start;                 /* past midnight on the evening shift */
  var day = onNext ? darShift(date, 1) : date;

  var checks = (DB.yardchecks || []).filter(function(c){
    return isoDate(c.date) === day && Math.floor((darMin(c.time)||0) / 60) === hour;
  });
  var escN = 0;
  checks.forEach(function(c){
    (c.rows || []).forEach(function(r){ if(r.escalate && r.escalate.length) escN++; });
  });

  var logs = (DB.logs || []).filter(function(r){ return isoDate(r.date) === day; });
  var into = logs.filter(function(r){
    var m = darMin(r.timein); return m != null && Math.floor(m/60) === hour; }).length;
  var out = logs.filter(function(r){
    var m = darMin(r.timeout); return m != null && Math.floor(m/60) === hour; }).length;

  return { check: checks.length > 0, esc: escN, in: into, out: out };
}
function darShift(iso, days){
  var p = String(iso).split('-');
  var d = new Date(+p[0], +p[1]-1, +p[2]);
  d.setDate(d.getDate() + days);
  return _darISO(d);
}

/* ---- the sentence for one hour ---- */
function darLine(a, opts){
  var who = 'Officer ' + (opts.name || 'on duty');
  var bits = [];

  if(opts.first){
    bits.push(who + ' resumes shift'
      + (a.check ? ' and conducts yard check' + darEscPhrase(a.esc) : ''));
  } else if(opts.last){
    bits.push(who + ' completes ' + opts.shift + ' shift'
      + (opts.handover ? ' and hands over to Officer ' + opts.handover : ''));
  } else if(a.check){
    bits.push(who + ' conducts yard check' + darEscPhrase(a.esc));
  } else if(a.in || a.out){
    bits.push(who + ' continues signing trailers in and out of the yard');
  }

  if(a.in || a.out){
    var t = [];
    if(a.in)  t.push(a.in + ' trailer' + (a.in===1?'':'s') + ' signed into the yard');
    if(a.out) t.push(a.out + (a.in ? ' signed out' : ' trailer' + (a.out===1?'':'s') + ' signed out'));
    bits.push(t.join(' and '));
  }

  if(!bits.length) return 'All Clear.';
  var line = bits.join('. ');
  if(!/\.$/.test(line)) line += '.';
  /* the paper always closes an eventful hour with All Clear */
  if(!opts.first) line += ' All Clear.';
  return line;
}
function darEscPhrase(n){
  if(!n) return ' with no escalations made';
  return ', ' + n + ' escalation' + (n===1?'':'s') + ' made';
}

/* ---- the whole shift, hour by hour ---- */
function darCompose(date, start, name, handover){
  var out = [];
  for(var i = 0; i <= 12; i++){
    var hour = (start + i) % 24;
    var a = darActivity(date, start, hour);
    out.push({
      hour: hour,
      time: darHour(hour),
      text: darLine(a, { name:name, first: i===0, last: i===12,
                         shift: darShiftLabel(start), handover: handover })
    });
  }
  return out;
}

/* ---- the draft the officer reads ---- */
function darBuild(){
  var cur = darCurrent();
  var name = getOfficerName() || '';
  DAR = {
    date: cur.date, start: cur.start,
    name: name, location: getLocation(),
    handover: '', incident: 'No', mode: 'preview',
    lines: darCompose(cur.date, cur.start, name, ''),
    edited: {}
  };
}
function darRedraft(){
  if(!DAR) return;
  var fresh = darCompose(DAR.date, DAR.start, DAR.name, DAR.handover);
  /* a line the officer rewrote is theirs; the rest follow the record */
  DAR.lines = fresh.map(function(l, i){
    return DAR.edited[i] ? DAR.lines[i] : l;
  });
  renderDar();
}
/* When the shift ends, and whether the record has anything on it yet. */
function darShiftEnd(){
  if(!DAR) return null;
  var p = String(DAR.date).split('-');
  var d = new Date(+p[0], +p[1]-1, +p[2], DAR.start, 0, 0);
  d.setHours(d.getHours() + 12);
  return d;
}
function darOver(now){ var e = darShiftEnd(); return !e || (now||new Date()) >= e; }
function darHasEntries(){
  return !!DAR && DAR.lines.some(function(l, i){
    return i !== 0 && i !== DAR.lines.length-1 && l.text !== 'All Clear.';
  });
}
/* the sheet keeps up with the shift while the officer has it open */
var _darTick = null;
function darStartTicking(){
  darStopTicking();
  _darTick = setInterval(function(){
    var sec = $('sec-dar');
    if(sec && sec.classList.contains('on') && DAR && DAR.mode !== 'edit') darRedraft();
    else if(!sec || !sec.classList.contains('on')) darStopTicking();
  }, 30000);
}
function darStopTicking(){ if(_darTick){ clearInterval(_darTick); _darTick = null; } }
function darMode(m){ if(DAR){ DAR.mode = m; renderDar(); window.scrollTo(0,0); } }
function darSet(k, v){
  if(!DAR) return;
  DAR[k] = v;
  if(k === 'handover') darRedraft();
}
function darSetLine(i, v){
  if(!DAR || !DAR.lines[i]) return;
  DAR.lines[i].text = v;
  DAR.edited[i] = true;
  var el = document.querySelector('#darbody tr[data-i="'+i+'"]');
  if(el) el.classList.add('own');
}
function darResetLine(i){
  if(!DAR) return;
  delete DAR.edited[i];
  darRedraft();
}

/* The report is a finished sheet, not a form. It is shown as it will be filed;
   Edit is there for the officer who spots something the app got wrong. */
function renderDar(){
  if(!DAR) darBuild();
  var host = $('darbody'); if(!host) return;
  var editing = DAR.mode === 'edit';
  var over = darOver();
  $('dar_edit').hidden = editing || !darHasEntries();
  $('dar_done').hidden = !editing;
  $('darhead').hidden = !editing;
  /* the report goes at the end of the shift, not before it */
  /* the button carries its label; the reason it is waiting sits under it */
  var sub = $('dar_submit');
  sub.disabled = !over;
  var why = $('dar_why');
  if(why){
    why.hidden = over;
    why.textContent = 'Available at ' + darHour(DAR.start + 12) + ', when your shift ends.';
  }
  var note = $('dar_live');
  if(note) note.hidden = editing;
  if(editing){
    $('dar_hand').value = DAR.handover || '';
    document.querySelectorAll('#sec-dar .darinc').forEach(function(b){
      b.classList.toggle('on', b.dataset.v === DAR.incident);
    });
    host.innerHTML = '<table class="dartab"><tr><th class="t">TIME</th><th>DESCRIPTION</th></tr>'
      + DAR.lines.map(function(l, i){
          return '<tr data-i="'+i+'"'+(DAR.edited[i]?' class="own"':'')+'>'
            + '<td class="t">'+esc(l.time)+'</td>'
            + '<td><textarea rows="2" oninput="darSetLine('+i+',this.value)">'
            +   esc(l.text)+'</textarea>'
            + (DAR.edited[i]
                ? '<button type="button" class="darundo" onclick="darResetLine('+i+')">'
                  + 'Use what the app recorded</button>' : '')
            + '</td></tr>';
        }).join('')
      + '</table>';
  } else {
    host.innerHTML = darPaperHTML(darData());
  }
}
/* the NPG sheet, laid out as it is on paper */
function darPaperHTML(d){
  var yes = d.incident === 'Yes';
  return '<div class="darpaper">'
    + '<div class="dphead">'
    +   '<div class="dpleft">'
    +     '<div><span>Date:</span><b>'+esc(fmtDate(d.date)||d.date)+'</b></div>'
    +     '<div><span>Shift:</span><b>'+esc(d.shift)+'</b></div>'
    +   '</div>'
    +   '<div class="dpbrand"><b>NPG</b><span>SECURITY SERVICES</span>'
    +     '<em>Daily Activity Report</em></div>'
    +   '<div class="dpright">'
    +     '<div><span>Any Incident?</span>'
    +       '<button type="button" class="dpinc'+(yes?' ring':'')+'"'
    +         ' onclick="darSet(\'incident\',\'Yes\');renderDar()">Yes</button> or '
    +       '<button type="button" class="dpinc'+(yes?'':' ring')+'"'
    +         ' onclick="darSet(\'incident\',\'No\');renderDar()">No</button></div>'
    +     '<div><span>Guard on Duty:</span><b>'+esc(d.name||'')+'</b></div>'
    +     '<div><span>Location:</span><b>'+esc(d.location||'')+'</b></div>'
    +   '</div>'
    + '</div>'
    + '<table class="dpt"><tr><th class="t">TIME</th><th>DESCRIPTION</th></tr>'
    + (d.lines||[]).map(function(l){
        return '<tr><td class="t">'+esc(l.time)+'</td><td>'+esc(l.text)+'</td></tr>';
      }).join('')
    + '</table>'
    + '<div class="dpsign"><span>Officer&rsquo;s Signature:</span>'
    +   '<b>'+esc(d.name||'')+'</b></div>'
    + '</div>';
}
function darSubmit(){
  if(!DAR) return;
  /* the panel's Daily activity report switches were read by nothing at all */
  var toEmail = (typeof admGoes === 'function') ? admGoes('dar', 'email') : true;
  var toTeam  = (typeof admGoes === 'function') ? admGoes('dar', 'app')   : false;
  var to = getManagerEmail();
  if(toEmail && !to){ toast('No manager email in Settings yet'); go('settings'); return; }
  if(!DAR.handover.trim() &&
     !confirm('No handover officer named. Submit the report anyway?')) return;
  var d = darData();
  DB.dars = DB.dars || [];
  DB.dars.unshift(d);
  if(DB.dars.length > 40) DB.dars.length = 40;
  darPersist();
  if(typeof beep==='function') beep();
  if(toTeam && window.darCloudAdd) darCloudAdd(d);
  if(toEmail) darSend(d);
  else toast('Daily activity report saved.');
}
function darData(){
  return { kind:'dar', ts:new Date().toISOString(),
    date:DAR.date, shift:darShiftHours(DAR.start), shiftName:darShiftLabel(DAR.start),
    name:DAR.name, location:DAR.location, handover:DAR.handover, incident:DAR.incident,
    officer:(window.CLOUD && CLOUD.user && CLOUD.user.email) || '',
    lines: DAR.lines.map(function(l){ return { time:l.time, text:l.text }; }) };
}
DB.dars = [];
try{ var _dar0 = sget('gc_dars'); if(_dar0) DB.dars = JSON.parse(_dar0); }catch(e){}
function darPersist(){ try{ sset('gc_dars', JSON.stringify(DB.dars.slice(0,20))); }catch(e){} }
function getManagerEmail(){ return (sget('gc_manager')||'').trim(); }

/* ---- the paper, drawn and sent ---- */
function darSend(d){
  var svc = getMailerUrl();
  drawDarPaper(d, function(cv){
    if(svc){
      toast('Sending the report\u2026');
      fetch(svc, {method:'POST', body: JSON.stringify({
        to:getManagerEmail(), cc:getCcEmails(),
        png:cv.toDataURL('image/png').split(',')[1],
        filename:'DAR_'+(d.date||'').replace(/-/g,'')+'_'+d.shiftName+'.png',
        po:'DAILY ACTIVITY REPORT '+d.date, carrier:'NPG Security Services',
        driver:d.name, datein:d.date, timein:d.shift,
        sealcond:(d.incident==='Yes'?'INCIDENT REPORTED':'NO INCIDENT'),
        sealtype:d.location, sealtrailer:d.shiftName.toUpperCase()+' SHIFT',
        sentBy:d.officer })})
      .then(function(r){ return r.json(); })
      .then(function(j){ toast(j && j.ok
        ? '\u2705 Report sent to your manager' : '\u26a0\ufe0f Send failed. Use Share.'); })
      .catch(function(){ toast('\u26a0\ufe0f Could not confirm the send. Check with your manager.'); });
    } else {
      cv.toBlob(function(b){
        var a=document.createElement('a');
        a.href=URL.createObjectURL(b);
        a.download='DAR_'+(d.date||'').replace(/-/g,'')+'.png'; a.click();
        toast('No mailer set up, so the report was downloaded instead.');
      },'image/png');
    }
  });
}
/* the NPG sheet, as it is filed on paper */
function drawDarPaper(d, done){
  var cv = $('paper'), g = cv.getContext('2d');
  cv.width = 1275; cv.height = 1650;
  g.setTransform(1,0,0,1,0,0);
  g.fillStyle='#fff'; g.fillRect(0,0,1275,1650);
  function txt(t,x,y,size,bold,center,color){
    g.fillStyle=color||'#111';
    g.font=(bold?'700 ':'')+size+'px -apple-system,Segoe UI,Roboto,sans-serif';
    g.textAlign=center?'center':'left'; g.textBaseline='middle';
    g.fillText(String(t==null?'':t), x, y);
  }
  txt('NPG', 90, 74, 46, true);
  txt('SECURITY SERVICES', 92, 108, 15, true, false, '#555');
  txt('Daily Activity Report', 92, 140, 22, true);
  txt('Date: '+ (fmtDate(d.date)||d.date), 92, 196, 17, true);
  txt('Shift: '+ d.shift, 92, 224, 17, true);
  txt('Any Incident?  '+(d.incident==='Yes'?'YES':'NO'), 720, 196, 17, true);
  txt('Guard on Duty: '+ (d.name||''), 720, 224, 17, true);
  txt('Location: '+ (d.location||''), 720, 252, 17, true);

  var top=300, rowH=88, x0=92, x1=210, x2=1183;
  g.strokeStyle='#111'; g.lineWidth=1;
  txt('TIME', x0+12, top+22, 13, true);
  txt('DESCRIPTION', x1+12, top+22, 13, true);
  g.beginPath(); g.moveTo(x0, top+40); g.lineTo(x2, top+40); g.stroke();
  (d.lines||[]).forEach(function(l, i){
    var y = top + 40 + i*rowH;
    g.beginPath(); g.moveTo(x0, y+rowH); g.lineTo(x2, y+rowH); g.stroke();
    g.beginPath(); g.moveTo(x0, y); g.lineTo(x0, y+rowH); g.stroke();
    g.beginPath(); g.moveTo(x1, y); g.lineTo(x1, y+rowH); g.stroke();
    g.beginPath(); g.moveTo(x2, y); g.lineTo(x2, y+rowH); g.stroke();
    txt(l.time, x0+14, y+rowH/2, 16, true);
    /* the description wraps rather than running off the page */
    var words = String(l.text||'').split(' '), line = '', out = [];
    g.font='15px -apple-system,Segoe UI,Roboto,sans-serif';
    words.forEach(function(w){
      var t = line ? line+' '+w : w;
      if(g.measureText(t).width > (x2-x1-28)){ out.push(line); line = w; }
      else line = t;
    });
    if(line) out.push(line);
    out.slice(0,3).forEach(function(t, k){
      txt(t, x1+14, y + rowH/2 - (out.length-1)*10 + k*20, 15);
    });
  });
  var foot = top + 40 + (d.lines||[]).length*rowH + 46;
  txt("Officer's Signature: "+(d.name||''), x0, foot, 16, true);
  g.beginPath(); g.moveTo(x0+230, foot+12); g.lineTo(x0+560, foot+12); g.stroke();
  txt('Generated by Checkpoint \u00b7 '+new Date(d.ts).toLocaleString(),
      637, 1600, 13, false, true, '#666');
  done(cv);
}

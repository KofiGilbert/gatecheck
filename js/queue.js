/* ===================== the gate queue =====================

   The officer at the gate files the seal form, and the driver walks over to
   the receiving office to be served. This is the line at that window: the
   same forms, stood in the order the drivers signed in, and the receiving
   officer looks at it to know who is next.

   Serving a driver touches nothing the officer recorded: the form stays
   exactly as it was filed. It only gains served / servedAt / servedBy, which
   is the office's own note that this one has been dealt with. The Firestore
   rules allow the office those three fields and no others.
*/

/* A driver queues for as long as their paperwork is today's problem. After
   24 hours an unserved slip is stale - that driver is long gone - and it
   drops off rather than standing at the head of the line forever. */
/* how long a driver stays on the list, set in the admin panel */
function qWindowMs(){
  var h = (typeof admSettings === 'function') ? admSettings().queueHours : 12;
  return (h > 0 ? h : 12) * 3600e3;
}

function queueForms(){
  var cutoff = Date.now() - qWindowMs();
  return (DB.forms || []).filter(function(f){
    var t = Date.parse(f && f.ts || '');
    return isFinite(t) && t >= cutoff;
  });
}
/* the line: oldest arrival first, which is what a queue is */
function queueWaiting(){
  return queueForms().filter(function(f){ return !f.served; })
    .sort(function(a, b){ return a.ts < b.ts ? -1 : 1; });
}
/* already seen to: most recent first, the way a done pile reads */
function queueServed(){
  return queueForms().filter(function(f){ return f.served; })
    .sort(function(a, b){
      return String(b.servedAt || b.ts) < String(a.servedAt || a.ts) ? -1 : 1;
    });
}
/* a seal that is not intact is the row the office reads first */
function queueFlag(f){
  var c = String(f && f.sealcond || '').toUpperCase();
  if(c.indexOf('BROKEN') >= 0 || c.indexOf('MISSING') >= 0) return c.split(' ')[0];
  return '';
}
function queueWho(f){
  return String(f.carrier || f.vendor || 'Unknown carrier').toUpperCase();
}
function queueClock(iso){
  var t = new Date(iso);
  if(isNaN(t)) return '';
  var h = t.getHours(), m = String(t.getMinutes()).padStart(2, '0');
  return String(h).padStart(2, '0') + ':' + m;
}

/* ---------- serving ---------- */
function queueSetServed(f, on){
  if(!f) return;
  f.served = !!on;
  f.servedAt = on ? new Date().toISOString() : '';
  f.servedBy = on ? ((window.CLOUD && CLOUD.user && CLOUD.user.email) || '') : '';
  if(window.CLOUD && CLOUD.ready && f._id){
    CLOUD.db.collection('forms').doc(f._id)
      .update({ served: f.served, servedAt: f.servedAt, servedBy: f.servedBy })
      .catch(function(e){ toast('Not marked: ' + e.message); });
  } else {
    persist();
  }
  renderQueue();
  if(typeof officeStat === 'function') officeStat();
}
function queueFind(id){
  return (DB.forms || []).filter(function(f){
    return (f._id || f.ts) === id;
  })[0] || null;
}
function queueServe(id){ queueSetServed(queueFind(id), true); }
function queueUnserve(id){ queueSetServed(queueFind(id), false); }

/* ---------- the screen ----------
   The rows wear the loaded-orders list's clothes - dayacc/daybar and the
   three labelled stat columns - so the office reads one visual language,
   not two. */
function queueRowHTML(f, pos){
  var id = esc(f._id || f.ts);
  var flag = queueFlag(f);
  var next = pos === 1;
  return '<div class="dayacc' + (next ? ' qnext' : '') + (flag ? ' qflag' : '') + '">'
    + '<div class="daybar">'
    +   '<button type="button" class="dbmain" onclick="queueView(\'' + id + '\')"'
    +     ' aria-label="Open the seal form for ' + esc(queueWho(f)) + '">'
    +     '<span class="dbtext">'
    +       '<span class="dbconf">#' + pos + (next ? ' \u00b7 NEXT' : '')
    +         ' \u00b7 ' + esc(queueClock(f.ts)) + '</span>'
    +       '<span class="dbdate">' + esc(queueWho(f))
    +         (flag ? '<i class="qseal">SEAL ' + esc(flag) + '</i>' : '') + '</span>'
    +     '</span>'
    +     '<span class="dbsum">'
    +       '<span class="dbstat"><b>' + esc(f.driver || '\u2014') + '</b><span>driver</span></span>'
    +       '<span class="dbstat"><b>' + esc(f.po || '\u2014') + '</b><span>po</span></span>'
    +       '<span class="dbstat"><b>' + esc(String(f.trailer || '\u2014').toUpperCase())
    +         '</b><span>trailer</span></span>'
    +     '</span>'
    +   '</button>'
    +   '<button type="button" class="qserve" onclick="queueServe(\'' + id + '\')">Serve</button>'
    + '</div></div>';
}
function queueServedRowHTML(f){
  var id = esc(f._id || f.ts);
  return '<div class="dayacc qdone"><div class="daybar">'
    + '<button type="button" class="dbmain" onclick="queueView(\'' + id + '\')">'
    +   '<span class="dbtext">'
    +     '<span class="dbconf">\u2713 served ' + esc(queueClock(f.servedAt || f.ts)) + '</span>'
    +     '<span class="dbdate">' + esc(queueWho(f)) + '</span>'
    +   '</span>'
    +   '<span class="dbsum">'
    +     '<span class="dbstat"><b>' + esc(queueClock(f.ts)) + '</b><span>in</span></span>'
    +     '<span class="dbstat"><b>' + esc(f.po || '\u2014') + '</b><span>po</span></span>'
    +   '</span>'
    + '</button>'
    + '<button type="button" class="qserve undo" onclick="queueUnserve(\'' + id + '\')"'
    +   ' aria-label="Put this driver back in the line">Undo</button>'
    + '</div></div>';
}
function renderQueue(){
  var host = $('queuebody'); if(!host) return;
  var line = queueWaiting(), done = queueServed();
  var html = '';
  if(!line.length){
    html += '<div class="qempty"><b>Nobody waiting.</b></div>';
  } else {
    html += line.map(function(f, i){ return queueRowHTML(f, i + 1); }).join('');
  }
  if(done.length){
    html += '<div class="qsep">Served today</div>'
      + done.map(queueServedRowHTML).join('');
  }
  host.innerHTML = html;
  var n = $('queuecnt');
  if(n) n.textContent = line.length ? '(' + line.length + ')' : '';
}

/* ---------- reading the form itself ----------
   Tapping a driver opens their seal form as it was filed - the same drawn sheet
   the email carries - with the Print button. A sub-route, so a refresh keeps
   it open and back closes it. */
function queueView(id){ go('queue', false, id); }
function queueViewSync(sub){
  var view = $('fqview'); if(!view) return;
  var f = sub ? queueFind(sub) : null;
  view.hidden = !f;
  document.body.classList.toggle('dayview-open', !!f);
  var list = $('queuelist'); if(list) list.hidden = !!f;
  if(!f) return;
  $('fqview_title').textContent = queueWho(f) + ' · ' + queueClock(f.ts);
  var host = $('fqview_body');
  host.innerHTML = '<div class="ycpaper" id="fqpaper"></div>';
  if(typeof drawPaper !== 'function') return;
  drawPaper(f, function(cv){
    var w = $('fqpaper');
    if(w) w.innerHTML = '<img alt="The seal form as it was filed" src="'
      + cv.toDataURL('image/png') + '">';
  });
}
function queueViewClose(){ go('queue'); }

/* the tile and the stat line say how many are standing in it */
function queueTileSync(){
  var em = $('qtile_sub'); if(!em) return;
  var n = queueWaiting().length;
  em.textContent = n
    ? (n === 1 ? 'One driver waiting' : n + ' drivers waiting')
    : 'Who to serve next';
}

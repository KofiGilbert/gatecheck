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
/* Three places a driver can be, not two. "Serve" was an imperative sitting on
   an action that ended the service rather than starting it, which is why
   pressing it felt like being told the job was already done. Serve keeps the
   word and fixes the deed: it opens their form and stands them at the window,
   and Mark served is the thing that finishes them - the shape every queue
   system uses, from a take-a-number counter to a dock scheduler.

   The state is read off two timestamps rather than a flag: nobody is at the
   window unless somebody called them there. */
function queueAtWindow(f){ return !!(f && f.calledAt && !f.served); }
/* the line: oldest arrival first, which is what a queue is */
function queueWaiting(){
  return queueForms().filter(function(f){ return !f.served && !f.calledAt; })
    .sort(function(a, b){ return a.ts < b.ts ? -1 : 1; });
}
/* One window, one driver at it. Calling somebody else sends the last one back
   to the head of the line rather than quietly losing them. */
function queueServing(){
  return queueForms().filter(queueAtWindow)
    .sort(function(a, b){ return a.calledAt < b.calledAt ? 1 : -1; });
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
  queuePush(f, { served: f.served, servedAt: f.servedAt, servedBy: f.servedBy });
}
function queueFind(id){
  return (DB.forms || []).filter(function(f){
    return (f._id || f.ts) === id;
  })[0] || null;
}
/* Calling is its own write, and it carries who did the calling for the same
   reason serving does. */
function queueSetCalled(f, on){
  if(!f) return;
  f.calledAt = on ? new Date().toISOString() : '';
  f.calledBy = on ? ((window.CLOUD && CLOUD.user && CLOUD.user.email) || '') : '';
  queuePush(f, { calledAt: f.calledAt, calledBy: f.calledBy });
}
/* one place that writes a form's queue fields, so the cloud path and the
   single-device path cannot drift apart */
function queuePush(f, fields){
  if(window.CLOUD && CLOUD.ready && f._id){
    CLOUD.db.collection('forms').doc(f._id).update(fields)
      .catch(function(e){ toast('Not saved to the team: ' + e.message); });
  } else {
    persist();
  }
  renderQueue();
  if(typeof queueViewSync === 'function') queueViewSync(routeSub('queue'));
  if(typeof officeStat === 'function') officeStat();
  if(typeof queueTileSync === 'function') queueTileSync();
}
/* Serve does the two things the word promises: it opens the driver's form,
   because you cannot serve somebody without reading their paperwork, and it
   puts them at the window so the rest of the office can see it. */
function queueCall(id){
  var f = queueFind(id); if(!f) return;
  queueServing().forEach(function(other){
    if(other !== f) queueSetCalled(other, false);
  });
  queueSetCalled(f, true);
  queueView(id);
}
function queueBackToLine(id){ queueSetCalled(queueFind(id), false); }
function queueServe(id){
  var f = queueFind(id); if(!f) return;
  queueSetServed(f, true);
  /* named, because by the time the toast is read the row has moved */
  toast(queueWho(f) + ' marked served', 'Undo', function(){ queueUnserve(id); });
}
/* Finishing from inside the form closes it, because that is the end of the
   job: you called the driver, the form opened, you dealt with them, done. It
   used to leave the sheet sitting there and need a third tap on the back
   arrow, which is what made the whole thing feel like ceremony.

   What it deliberately does NOT do is finish them when you simply leave. A
   driver turned away on a broken seal, a form opened to print, a checked PO,
   an iPad edge-swipe - all of those are "coming out of the tab", and none of
   them means the driver was served. servedAt and servedBy are the record of
   who dealt with whom, and a record written by a back gesture is not one you
   can trust. Back goes back; this button finishes. */
function queueServeClose(id){ queueServe(id); queueViewClose(); }
/* Un-marking puts a driver back where the mistake was made - at the window,
   mid-service - and not at the back of a line they had already left. */
function queueUnserve(id){ queueSetServed(queueFind(id), false); }

/* ---------- the screen ----------
   The rows wear the loaded-orders list's clothes - dayacc/daybar and the
   three labelled stat columns - so the office reads one visual language,
   not two. */
/* The row body used to be one enormous <button> wrapping the carrier, the
   driver, the PO and the trailer, sitting beside a second button. Nothing in
   it looked like a control, so every part of the row was clickable and none of
   it said what it would do - which is exactly how pressing the action button
   came to feel like a guess. A screen reader had it worse: the aria-label on
   that button became the whole row's name, so the driver, the PO and the
   trailer were never read out at all.

   Now the carrier name is the one control, it carries a chevron so it reads
   as one, and its hit area is stretched across the body of the row and stops
   where the action button begins. The figures beside it are text again. */
/* The place in the line, read as a place in a line: a numeral in its own
   column with a rule beside it, the way a ticket queue has always shown it.
   It used to be "#1 \u00b7 NEXT \u00b7 15:31" set in 9.5px grey - three
   different things run together in the smallest type on the row, so you could
   not tell at a glance that the list was numbered at all, let alone who was
   next. */
function queuePosHTML(pos, next){
  return '<span class="qpos' + (next ? ' now' : '') + '" aria-hidden="true">'
    + '<b>' + pos + '</b>' + (next ? '<i>NEXT</i>' : '') + '</span>';
}
function queueMarkHTML(cls, mark, word){
  return '<span class="qpos ' + cls + '" aria-hidden="true">'
    + '<b>' + mark + '</b><i>' + word + '</i></span>';
}
/* the figures on a row, the same three columns in the same order everywhere */
function queueStatsHTML(f, third){
  return '<span class="dbsum">'
    + '<span class="dbstat"><b>' + esc(f.driver || '\u2014') + '</b><span>driver</span></span>'
    + '<span class="dbstat"><b>' + esc(f.po || '\u2014') + '</b><span>po</span></span>'
    + third
    + '</span>';
}
/* Nothing on a row is clickable except the buttons on it. The body used to be
   a control with its hit area stretched across the whole row, which meant the
   only way to know what a click would do was to have been told. */
function queueRowHTML(f, pos){
  var id = esc(f._id || f.ts);
  var flag = queueFlag(f);
  var next = pos === 1;
  /* built here rather than inline: a continuation line that starts with "+"
     inside a call argument reads as a unary plus, and turned the clock into
     NaN on the rows where the value was not all digits */
  var trailerCol = '<span class="dbstat"><b>'
    + esc(String(f.trailer || '\u2014').toUpperCase()) + '</b><span>trailer</span></span>';
  return '<div class="dayacc' + (next ? ' qnext' : '') + (flag ? ' qflag' : '') + '">'
    + '<div class="daybar">'
    +   queuePosHTML(pos, next)
    +   '<div class="dbmain qbody">'
    +     '<span class="dbtext">'
    +       '<span class="dbconf">Waiting since ' + esc(queueClock(f.ts)) + '</span>'
    +       '<span class="dbdate">' + esc(queueWho(f))
    +         (flag ? '<i class="qseal">SEAL ' + esc(flag) + '</i>' : '') + '</span>'
    +     '</span>'
    +     queueStatsHTML(f, trailerCol)
    +   '</div>'
    /* Serve, because that is what it does now: it opens the driver's form and
       stands them at the window. The word was never the problem - the old
       button said Serve and quietly finished them instead. */
    +   '<button type="button" class="qserve" onclick="queueCall(\'' + id + '\')"'
    +     ' aria-label="Serve ' + esc(queueWho(f)) + ': open their form and bring them to the window">'
    +     'Serve</button>'
    + '</div></div>';
}
/* The driver at the window, above the line, because they are the one the
   office is dealing with right now. */
function queueServingRowHTML(f){
  var id = esc(f._id || f.ts);
  var flag = queueFlag(f);
  var inCol = '<span class="dbstat"><b>' + esc(queueClock(f.ts))
    + '</b><span>in</span></span>';
  return '<div class="dayacc qserving' + (flag ? ' qflag' : '') + '"><div class="daybar">'
    + queueMarkHTML('win', '\u25cf', 'NOW')
    + '<div class="dbmain qbody">'
    +   '<span class="dbtext">'
    +     '<span class="dbconf qwin">At the window since '
    +       esc(queueClock(f.calledAt)) + '</span>'
    +     '<span class="dbdate">' + esc(queueWho(f))
    +       (flag ? '<i class="qseal">SEAL ' + esc(flag) + '</i>' : '') + '</span>'
    +   '</span>'
    +   queueStatsHTML(f, inCol)
    + '</div>'
    /* quieter than Mark served beside it: reading the form is the lesser of
       the two things you came to this row to do */
    + '<button type="button" class="qserve ghost" onclick="queueView(\'' + id + '\')"'
    +   ' aria-label="Open the seal form for ' + esc(queueWho(f)) + '">Open</button>'
    + '<button type="button" class="qserve" onclick="queueServe(\'' + id + '\')">Mark served</button>'
    + '</div></div>';
}
function queueServedRowHTML(f){
  var id = esc(f._id || f.ts);
  var inCol = '<span class="dbstat"><b>' + esc(queueClock(f.ts))
    + '</b><span>in</span></span>';
  return '<div class="dayacc qdone"><div class="daybar">'
    + queueMarkHTML('done', '\u2713', 'DONE')
    + '<div class="dbmain qbody">'
    +   '<span class="dbtext">'
    +     '<span class="dbconf">Served at ' + esc(queueClock(f.servedAt || f.ts)) + '</span>'
    +     '<span class="dbdate">' + esc(queueWho(f)) + '</span>'
    +   '</span>'
    +   queueStatsHTML(f, inCol)
    + '</div>'
    /* the only way left to read a finished driver's paperwork, now that the
       row itself is not a control */
    + '<button type="button" class="qserve ghost" onclick="queueView(\'' + id + '\')"'
    +   ' aria-label="Open the seal form for ' + esc(queueWho(f)) + '">Open</button>'
    + '<button type="button" class="qserve undo" onclick="queueUnserve(\'' + id + '\')"'
    +   ' aria-label="Put this driver back at the window">Undo</button>'
    + '</div></div>';
}
function renderQueue(){
  var host = $('queuebody'); if(!host) return;
  var at = queueServing(), line = queueWaiting(), done = queueServed();
  var html = '';
  if(at.length){
    html += '<div class="qsep qsepnow">At the window</div>'
      + at.map(queueServingRowHTML).join('')
      + '<div class="qsep">Waiting</div>';
  }
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
  /* You have to open the form to serve a driver - you cannot check paperwork
     without reading it - so the action that finishes them belongs here, on the
     sheet you already have open, and not only back on the list. */
  host.innerHTML = queueViewActHTML(f) + '<div class="ycpaper" id="fqpaper"></div>';
  if(typeof drawPaper !== 'function') return;
  drawPaper(f, function(cv){
    var w = $('fqpaper');
    if(w) w.innerHTML = '<img alt="The seal form as it was filed" src="'
      + cv.toDataURL('image/png') + '">';
  });
}
function queueViewActHTML(f){
  var id = esc(f._id || f.ts);
  if(f.served)
    return '<div class="qact"><span class="qactnow done">\u2713 Served at '
      + esc(queueClock(f.servedAt || f.ts)) + '</span>'
      + '<button type="button" class="qserve undo" onclick="queueUnserve(\'' + id + '\')">'
      + 'Undo</button></div>';
  if(queueAtWindow(f))
    return '<div class="qact"><span class="qactnow win">At the window since '
      + esc(queueClock(f.calledAt)) + '</span>'
      + '<button type="button" class="qserve ghost" onclick="queueBackToLine(\'' + id + '\')">'
      + 'Back to line</button>'
      + '<button type="button" class="qserve" onclick="queueServeClose(\'' + id + '\')">'
      + 'Mark served</button></div>';
  return '<div class="qact"><span class="qactnow">Waiting since '
    + esc(queueClock(f.ts)) + '</span>'
    + '<button type="button" class="qserve" onclick="queueCall(\'' + id + '\')">'
    + 'Call to the window</button></div>';
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

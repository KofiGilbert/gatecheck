/* ===================== Analytics =====================
   What the receiving office can actually measure, and nothing it cannot.

   Every figure here is a join between two things the site already records:
   the schedule the office publishes (orders) and the gate log the officers
   fill in (logs). They meet on the order number, so an order is "arrived"
   only when a seal verification form was pushed for it.

   The definitions follow the ones used across dock scheduling and yard
   management, so the numbers mean the same thing they mean to a carrier:

     on time        arrival within +/- 15 minutes of the appointment
     no-show        an appointment that never arrived (a late truck is late,
                    NOT a no-show; counting it as one flatters nobody)
     turnaround     gate-out minus gate-in
     adherence      on-time arrivals / appointments kept

   Where the paperwork cannot answer a question, this file says so rather than
   inventing a number: an order with no appointment time cannot be scored for
   punctuality, and a truck with no time out has no turnaround yet.
*/

var AN_ONTIME_MIN = 15;    /* the industry's on-time window, either side */
var AN_NOSHOW_MIN = 120;   /* not called a no-show until two hours past due */
var AN_TURN_TARGET = 120;  /* a live unload is expected to clear inside two hours */
var AN_RANGE = { kind: 'today', date: null };
/* the wall clock, unless something has pinned it; a test needs a fixed "now"
   to say whether an appointment is merely late or genuinely missed */
var AN_NOW = null;
function anNowMin(){
  if(AN_NOW != null) return AN_NOW;
  var n = new Date(); return n.getHours()*60 + n.getMinutes();
}

/* Both records store ISO now, so the join is a plain match. isoDate() is still
   used on the way in: a gate log row written before that change comes back in
   the officer's own M/D/YY and is translated as it is read. */

/* '730' | '1730' | '07:30' | '???'  ->  minutes since midnight, or null */
function anMin(t){
  var s = String(t == null ? '' : t).replace(/[^0-9]/g, '');
  if(!s || s.length > 4) return null;
  var n = parseInt(s, 10);
  if(isNaN(n)) return null;
  var h = s.length <= 2 ? n : Math.floor(n / 100);
  var m = s.length <= 2 ? 0 : n % 100;
  if(h > 23 || m > 59) return null;
  return h * 60 + m;
}
function anHHMM(mins){
  if(mins == null) return '';
  var h = Math.floor(mins / 60), m = mins % 60;
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}
/* a duration reads better as "1h 25m" than as 85 */
function anDur(mins){
  if(mins == null) return '—';
  var h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return h ? h + 'h ' + (m < 10 ? '0' : '') + m + 'm' : m + 'm';
}
function anISO(d){
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0')
    + '-' + String(d.getDate()).padStart(2,'0');
}
function anShiftDate(iso, days){
  var p = String(iso).split('-');
  var d = new Date(+p[0], +p[1]-1, +p[2]);
  d.setDate(d.getDate() + days);
  return anISO(d);
}
function anDayName(iso){
  var p = String(iso).split('-');
  if(p.length !== 3) return iso;
  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(+p[0], +p[1]-1, +p[2]).getDay()];
}

/* ---- one day, order by order ---- */
function anRows(date, nowMin){
  var today = isoToday();
  if(nowMin == null) nowMin = anNowMin();
  var orders = DB.orders.filter(function(o){ return isoDate(o.date) === date; });
  var logs   = (DB.logs || []).filter(function(r){ return isoDate(r.date) === date; });

  var byPo = {};
  logs.forEach(function(r){
    var k = String(r.po || '').trim();
    if(k && !byPo[k]) byPo[k] = r;      /* the first arrival is the one that counts */
  });

  var seen = {};
  var rows = orders.map(function(o){
    var key = String(o.order || '').trim();
    var log = byPo[key];
    if(log) seen[key] = 1;
    var appt   = anMin(o.time);
    var tin    = log ? anMin(log.timein)  : null;
    var tout   = log ? anMin(log.timeout) : null;
    var state, punctual = null, delta = null, turn = null;

    if(tin != null && tout != null){
      state = 'completed';
      turn = tout - tin;
      if(turn < 0) turn += 1440;        /* a truck that left after midnight */
    } else if(tin != null){
      state = 'onsite';
    } else if(appt == null){
      /* the schedule carries "???" for plenty of loads; guessing would be worse
         than admitting the appointment time is not known */
      state = 'unknown';
    } else if(date < today){
      state = 'noshow';
    } else if(date > today){
      state = 'due';
    } else {
      state = (nowMin > appt + AN_NOSHOW_MIN) ? 'noshow' : 'due';
    }
    if(tin != null && appt != null){
      delta = tin - appt;
      punctual = Math.abs(delta) <= AN_ONTIME_MIN ? 'ontime' : (delta < 0 ? 'early' : 'late');
    }
    return { o:o, log:log||null, state:state, punctual:punctual,
             delta:delta, turn:turn, appt:appt, tin:tin, tout:tout };
  });

  /* trucks that turned up without an appointment on the schedule */
  var extra = logs.filter(function(r){ return !seen[String(r.po||'').trim()]; })
    .map(function(r){
      var tin = anMin(r.timein), tout = anMin(r.timeout), turn = null;
      if(tin != null && tout != null){ turn = tout - tin; if(turn < 0) turn += 1440; }
      return { o:{ order:r.po, vendor:'', carrier:r.carrier||'', cases:0, pallets:0,
                   detail:'', date:date },
               log:r, state: tout!=null ? 'completed' : 'onsite', punctual:null,
               delta:null, turn:turn, appt:null, tin:tin, tout:tout, unscheduled:true };
    });
  return { date:date, rows:rows, extra:extra };
}

/* ---- the totals a manager reads first ---- */
function anTotals(days){
  var t = { scheduled:0, arrived:0, completed:0, onsite:0, due:0, noshow:0, unknown:0,
            unscheduled:0, cases:0, casesIn:0, pallets:0, palletsIn:0,
            early:0, ontime:0, late:0, scored:0,
            turnAll:[], turnLive:[], turnDrop:[] };
  days.forEach(function(d){
    d.rows.forEach(function(r){
      t.scheduled++;
      t.cases   += (+r.o.cases   || 0);
      t.pallets += (+r.o.pallets || 0);
      if(r.state === 'completed' || r.state === 'onsite'){
        t.arrived++;
        t.casesIn   += (+r.o.cases   || 0);
        t.palletsIn += (+r.o.pallets || 0);
      }
      if(r.state === 'completed') t.completed++;
      if(r.state === 'onsite')    t.onsite++;
      if(r.state === 'due')       t.due++;
      if(r.state === 'noshow')    t.noshow++;
      if(r.state === 'unknown')   t.unknown++;
      if(r.punctual){ t.scored++; t[r.punctual]++; }
      if(r.turn != null){
        t.turnAll.push(r.turn);
        if(String(r.o.detail).toUpperCase() === 'LIVE') t.turnLive.push(r.turn);
        else if(String(r.o.detail).toUpperCase() === 'DROP') t.turnDrop.push(r.turn);
      }
    });
    d.extra.forEach(function(r){
      t.unscheduled++;
      if(r.turn != null) t.turnAll.push(r.turn);
    });
  });
  t.adherence = t.scored ? Math.round(t.ontime / t.scored * 100) : null;
  /* the no-show rate is measured against appointments that could be judged:
     an order with no appointment time was never scoreable either way */
  var judged = t.scheduled - t.unknown - t.due;
  t.noshowRate = judged > 0 ? Math.round(t.noshow / judged * 100) : null;
  t.turnAvg  = anAvg(t.turnAll);
  t.turnLiveAvg = anAvg(t.turnLive);
  t.turnDropAvg = anAvg(t.turnDrop);
  return t;
}
function anAvg(a){ return a.length ? Math.round(a.reduce(function(x,y){ return x+y; },0) / a.length) : null; }
function anMedian(a){
  if(!a.length) return null;
  var s = a.slice().sort(function(x,y){ return x-y; });
  var i = Math.floor(s.length/2);
  return s.length % 2 ? s[i] : Math.round((s[i-1]+s[i])/2);
}

/* ---- which days the chosen range covers ---- */
function anRangeDates(){
  var today = isoToday();
  if(AN_RANGE.kind === 'day')  return [AN_RANGE.date || today];
  if(AN_RANGE.kind === 'today') return [today];
  if(AN_RANGE.kind === 'yesterday') return [anShiftDate(today, -1)];
  var n = AN_RANGE.kind === 'd30' ? 30 : 7, out = [];
  for(var i = n-1; i >= 0; i--) out.push(anShiftDate(today, -i));
  return out;
}
function anRangeLabel(){
  var today = isoToday();
  if(AN_RANGE.kind === 'today') return 'Today, ' + fmtLongDate(today);
  if(AN_RANGE.kind === 'yesterday') return 'Yesterday, ' + fmtLongDate(anShiftDate(today,-1));
  if(AN_RANGE.kind === 'day') return fmtLongDate(AN_RANGE.date || today);
  return (AN_RANGE.kind === 'd30' ? 'Last 30 days' : 'Last 7 days')
    + ' · ' + fmtLongDate(anShiftDate(today, AN_RANGE.kind==='d30' ? -29 : -6))
    + ' to ' + fmtLongDate(today);
}
function anSetRange(kind, date){
  AN_RANGE = { kind:kind, date:date || null };
  renderStats();
}

/* ---- carrier scorecard: worst first, because that is what gets acted on ---- */
function anCarriers(days){
  var by = {};
  days.forEach(function(d){
    d.rows.forEach(function(r){
      var c = String(r.o.carrier || '').trim() || 'Not stated';
      var e = by[c] || (by[c] = { carrier:c, appts:0, arrived:0, ontime:0, scored:0,
                                  noshow:0, late:0, turns:[] });
      e.appts++;
      if(r.state === 'completed' || r.state === 'onsite') e.arrived++;
      if(r.state === 'noshow') e.noshow++;
      if(r.punctual){ e.scored++; if(r.punctual === 'ontime') e.ontime++;
                      if(r.punctual === 'late') e.late++; }
      if(r.turn != null) e.turns.push(r.turn);
    });
  });
  return Object.keys(by).map(function(k){
    var e = by[k];
    e.adherence = e.scored ? Math.round(e.ontime / e.scored * 100) : null;
    e.turnAvg = anAvg(e.turns);
    return e;
  }).sort(function(a,b){
    /* most no-shows first, then worst adherence, then busiest */
    if(b.noshow !== a.noshow) return b.noshow - a.noshow;
    var aa = a.adherence == null ? 101 : a.adherence;
    var bb = b.adherence == null ? 101 : b.adherence;
    if(aa !== bb) return aa - bb;
    return b.appts - a.appts;
  });
}

/* ---- when the gate is busy: arrivals per two-hour block ---- */
function anByBlock(days){
  var b = [];
  for(var i = 0; i < 12; i++) b.push({ from:i*120, count:0, due:0 });
  days.forEach(function(d){
    d.rows.forEach(function(r){
      if(r.tin != null) b[Math.floor(r.tin/120)].count++;
      else if(r.appt != null) b[Math.floor(r.appt/120)].due++;
    });
    d.extra.forEach(function(r){ if(r.tin != null) b[Math.floor(r.tin/120)].count++; });
  });
  return b;
}

/* ===================== the dashboard =====================
   A bento grid: twelve columns, tiles sized by how much the figure matters
   rather than by how much data sits behind it. The whole answer to "is the day
   all right?" is meant to land in one screen; the long lists live behind a
   "see all", not dumped down the page.
*/

/* the same period, one period earlier, so a figure can be compared */
function anPrevDates(){
  var d = anRangeDates(), n = d.length;
  var first = d[0], out = [];
  for(var i = n; i >= 1; i--) out.push(anShiftDate(first, -i));
  return out;
}
function anDelta(now, was){
  if(was == null || was === 0) return '';
  var pct = Math.round((now - was) / was * 100);
  if(pct === 0) return '<span class="delta flat">no change</span>';
  return '<span class="delta ' + (pct > 0 ? 'up' : 'down') + '">'
    + (pct > 0 ? '▲' : '▼') + ' ' + Math.abs(pct) + '%</span>';
}

/* ---- small chart primitives, drawn by hand: no library, no network ---- */
function anDonut(segs, total, mid, sub, label){
  var R = 54, C = 2 * Math.PI * R, off = 0;
  var arcs = segs.filter(function(s){ return s.n > 0; }).map(function(s){
    var len = total ? (s.n / total) * C : 0;
    var el = '<circle r="' + R + '" cx="70" cy="70" fill="none" stroke="' + s.color + '"'
      + ' stroke-width="17" stroke-dasharray="' + len + ' ' + (C - len) + '"'
      + ' stroke-dashoffset="' + (-off) + '" transform="rotate(-90 70 70)"></circle>';
    off += len;
    return el;
  }).join('');
  return '<svg class="donut" viewBox="0 0 140 140" role="img" aria-label="' + esc(label) + '">'
    + '<circle r="' + R + '" cx="70" cy="70" fill="none" stroke="currentColor"'
    +   ' stroke-opacity=".14" stroke-width="17"></circle>'
    + arcs
    + '<text class="dmid" x="70" y="68">' + esc(mid) + '</text>'
    + '<text class="dsub" x="70" y="88">' + esc(sub) + '</text>'
    + '</svg>';
}
function anGauge(pct, cls, mid, sub, label){
  var C = Math.PI * 52;
  var len = C * Math.max(0, Math.min(100, pct)) / 100;
  var d = 'M13 64 A52 52 0 0 1 117 64';
  return '<svg class="gauge" viewBox="0 0 130 84" role="img" aria-label="' + esc(label) + '">'
    + '<path d="' + d + '" fill="none" stroke="currentColor" stroke-opacity=".14"'
    +   ' stroke-width="13" stroke-linecap="round"></path>'
    + '<path d="' + d + '" fill="none" class="' + cls + '" stroke-width="13" stroke-linecap="round"'
    +   ' stroke-dasharray="' + len + ' ' + (C - len) + '"></path>'
    + '<text class="gmid" x="65" y="58">' + esc(mid) + '</text>'
    + '<text class="gsub" x="65" y="76">' + esc(sub) + '</text>'
    + '</svg>';
}
/* Two series over the same days: what was booked, and what turned up.
   The day names are HTML underneath rather than <text> inside, because the SVG
   is stretched to the tile width and stretched text is unreadable. */
function anTrendChart(series, label){
  var W = 620, H = 128, P = 6;
  var max = Math.max.apply(null, series.map(function(p){ return p.sched; }).concat([1]));
  var n = series.length;
  var x = function(i){ return P + (W - P*2) * (n < 2 ? .5 : i / (n - 1)); };
  var y = function(v){ return H - 6 - (H - 20) * (v / max); };
  var line = function(k){ return series.map(function(p, i){
    return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p[k]).toFixed(1); }).join(' '); };
  var area = line('sched') + ' L' + x(n-1).toFixed(1) + ' ' + (H-6) + ' L' + x(0).toFixed(1)
    + ' ' + (H-6) + ' Z';
  var dots = series.map(function(p, i){
    return '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(p.arrived).toFixed(1) + '" r="4"'
      + ' class="tdot"><title>' + esc(p.name + ': ' + p.arrived + ' of ' + p.sched)
      + '</title></circle>'; }).join('');
  return '<div class="trendwrap">'
    + '<svg class="trend" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none"'
    +   ' role="img" aria-label="' + esc(label) + '">'
    +   '<path class="tarea" d="' + area + '"></path>'
    +   '<path class="tsched" d="' + line('sched') + '" fill="none"></path>'
    +   '<path class="tarr" d="' + line('arrived') + '" fill="none"></path>'
    +   dots
    + '</svg>'
    + '<div class="tlabs">' + series.map(function(p){
        return '<span>' + esc(p.name) + '</span>'; }).join('') + '</div>'
    + '</div>';
}
function anKeyRow(items){
  return '<div class="ankey">' + items.map(function(i){
    return '<span><i style="background:' + i.color + '"></i>' + esc(i.label)
      + ' <b>' + i.n + '</b></span>'; }).join('') + '</div>';
}
function anPct(n, d){ return d > 0 ? Math.round(n / d * 100) : 0; }

var AN_C = { done:'#4C6C1A', onsite:'#3E7CA8', due:'#C9A227', noshow:'#C0392B',
             unknown:'#98A2B0', early:'#7FA6D9', lime:'#BEF91B' };

/* ---- the grid ---- */
function renderStats(){
  var host = $('statsbody'); if(!host) return;
  var dates = anRangeDates();
  var days  = dates.map(function(d){ return anRows(d); });
  var t     = anTotals(days);
  var prev  = anTotals(anPrevDates().map(function(d){ return anRows(d); }));
  var live  = dates.indexOf(isoToday()) >= 0;

  $('an_range').textContent = anRangeLabel();
  document.querySelectorAll('#sec-stats .anchip').forEach(function(b){
    b.classList.toggle('on', b.dataset.kind === AN_RANGE.kind);
  });

  if(!t.scheduled && !t.unscheduled){
    host.innerHTML = '<div class="bento"><div class="btile c12 blank">'
      + '<div class="blankmark">ὌA</div>'
      + '<b>Nothing scheduled for this period</b>'
      + '<span>Upload a schedule, and these figures fill in as officers push '
      + 'their seal verification forms.</span></div></div>';
    anListSync('');
    return;
  }

  host.innerHTML = '<div class="bento">'
    + anTileHero(t, live)
    + anTileAdherence(t)
    + anTileTurn(t)
    + anStrip(t, prev, live)
    + anTileGate(days)
    + anTileChase(days)
    + anTileTrend()
    + anTileCarriers(days)
    + '</div>';
  anListSync(routeSub('stats'));
}

/* the one tile that answers "is the day all right?" */
function anTileHero(t, live){
  var segs = [
    { n:t.completed, color:AN_C.done,   label:'Completed' },
    { n:t.onsite,    color:AN_C.onsite, label:live ? 'On site' : 'Never left' },
    { n:t.due,       color:AN_C.due,    label:'Still to come' },
    { n:t.noshow,    color:AN_C.noshow, label:'No-show' },
    { n:t.unknown,   color:AN_C.unknown,label:'No appt time' },
  ];
  var pct = anPct(t.arrived, t.scheduled);
  return '<section class="btile c4 r2 hero">'
    + '<div class="th"><b>The day’s progress</b><span>' + t.scheduled + ' booked</span></div>'
    + anDonut(segs, t.scheduled, pct + '%', 'received',
        segs.map(function(s){ return s.label + ' ' + s.n; }).join(', '))
    + anKeyRow(segs.filter(function(s){ return s.n > 0; }))
    + '<div class="tf"><b>' + t.casesIn.toLocaleString() + '</b> of '
    +   t.cases.toLocaleString() + ' cases in'
    +   (t.unscheduled ? ' · <b>' + t.unscheduled + '</b> unbooked' : '')
    + '</div></section>';
}

function anTileAdherence(t){
  if(!t.scored){
    return '<section class="btile c4 r2"><div class="th"><b>On-time arrivals</b></div>'
      + '<div class="waiting">Nothing to time yet.<span>Needs an appointment time on '
      + 'the schedule and a time in on the gate log.</span></div></section>';
  }
  var band = t.adherence >= 85 ? 'g-good' : t.adherence >= 70 ? 'g-due' : 'g-bad';
  var segs = [
    { n:t.early,  color:AN_C.early,  label:'Early' },
    { n:t.ontime, color:AN_C.done,   label:'On time' },
    { n:t.late,   color:AN_C.noshow, label:'Late' },
  ];
  return '<section class="btile c4 r2"><div class="th"><b>On-time arrivals</b>'
    + '<span>target 85%</span></div>'
    + anGauge(t.adherence, band, t.adherence + '%', 'of ' + t.scored + ' timed',
        t.adherence + ' per cent on time, ' + segs.map(function(s){
          return s.label + ' ' + s.n; }).join(', '))
    + anKeyRow(segs)
    + '<div class="tf">Within ' + AN_ONTIME_MIN + ' minutes either side of the appointment.'
    + (t.unknown ? ' ' + t.unknown + ' had no appointment time.' : '') + '</div></section>';
}

function anTileTurn(t){
  if(!t.turnAll.length){
    return '<section class="btile c4 r2"><div class="th"><b>Turnaround</b></div>'
      + '<div class="waiting">No completed visit yet.<span>Turnaround appears once an '
      + 'officer fills in the time out.</span></div></section>';
  }
  var band = t.turnAvg <= AN_TURN_TARGET ? 'good' : 'bad';
  function row(label, avg, n){
    if(avg == null) return '';
    var w = Math.min(100, avg / (AN_TURN_TARGET * 2) * 100);
    return '<div class="brow"><span class="bl">' + esc(label) + '</span>'
      + '<span class="bt"><i class="' + (avg <= AN_TURN_TARGET ? 'f-good' : 'f-bad')
      +   '" style="width:' + w + '%"></i>'
      + '<u style="left:50%" title="two hour mark"></u></span>'
      + '<span class="bv">' + anDur(avg) + '</span></div>';
  }
  return '<section class="btile c4 r2"><div class="th"><b>Turnaround</b>'
    + '<span>gate in to gate out</span></div>'
    + '<div class="big ' + band + '">' + anDur(t.turnAvg)
    +   '<em>average · ' + anDur(anMedian(t.turnAll)) + ' typical</em></div>'
    + row('LIVE unload', t.turnLiveAvg, t.turnLive.length)
    + row('DROP', t.turnDropAvg, t.turnDrop.length)
    + '<div class="tf">Over ' + t.turnAll.length + ' completed visit'
    +   (t.turnAll.length === 1 ? '' : 's') + '. The mark is the two-hour line.</div></section>';
}

/* the numbers a manager reads without stopping */
function anStrip(t, prev, live){
  var cells = [
    { n:t.scheduled, l:'Scheduled', was:prev.scheduled, cls:'k-plain' },
    { n:t.arrived,   l:'Arrived',   was:prev.arrived,   cls:'k-done' },
    { n:t.completed, l:'Completed', was:prev.completed, cls:'k-done' },
    { n:t.onsite,    l:live ? 'On site' : 'Never left', was:null, cls:'k-onsite' },
    { n:t.due,       l:live ? 'Still to come' : 'Not due', was:null, cls:'k-due' },
    { n:t.noshow,    l:'No-shows',  was:prev.noshow,    cls:'k-bad' },
  ];
  return '<div class="btile c12 strip">' + cells.map(function(c){
    return '<div class="kpi ' + (c.n || c.cls === 'k-plain' ? c.cls : '') + '">'
      + '<b>' + c.n + '</b><span>' + esc(c.l) + '</span>'
      + anDelta(c.n, c.was) + '</div>';
  }).join('') + '</div>';
}

function anTileGate(days){
  var b = anByBlock(days);
  var max = Math.max.apply(null, b.map(function(x){ return x.count + x.due; }).concat([1]));
  var bars = b.map(function(x){
    return '<div class="gcol" title="' + anHHMM(x.from) + ' – ' + x.count
      + ' arrived, ' + x.due + ' expected">'
      + '<span class="gstack">'
      +   '<i class="g-due" style="height:' + anPct(x.due, max) + '%"></i>'
      +   '<i class="g-arr" style="height:' + anPct(x.count, max) + '%"></i>'
      + '</span><em>' + anHHMM(x.from).slice(0,2) + '</em></div>';
  }).join('');
  return '<section class="btile c7"><div class="th"><b>When the gate is busy</b>'
    + '<span>two-hour blocks</span></div>'
    + '<div class="gate" role="img" aria-label="Arrivals per two-hour block: '
    +   b.map(function(x){ return anHHMM(x.from) + ' ' + x.count; }).join(', ') + '">'
    +   bars + '</div>'
    + anKeyRow([{ n:b.reduce(function(a,x){ return a+x.count; },0), color:AN_C.done, label:'Arrived' },
                { n:b.reduce(function(a,x){ return a+x.due; },0), color:AN_C.due, label:'Expected' }])
    + '</section>';
}

function anTileTrend(){
  var today = isoToday(), series = [], week = [];
  for(var i = 6; i >= 0; i--){
    var d = anShiftDate(today, -i);
    var t = anTotals([anRows(d)]);
    series.push({ name:anDayName(d), sched:t.scheduled, arrived:t.arrived });
    week.push(d);
  }
  var w = anTotals(week.map(function(d){ return anRows(d); }));
  return '<section class="btile c7"><div class="th"><b>The last seven days</b>'
    + '<span>booked against arrived</span></div>'
    + anTrendChart(series, series.map(function(p){
        return p.name + ' ' + p.arrived + ' of ' + p.sched; }).join(', '))
    + anKeyRow([{ n:w.scheduled, color:AN_C.due, label:'Booked' },
                { n:w.arrived, color:AN_C.done, label:'Arrived' }])
    + '<div class="tf"><b>' + w.noshow + '</b> no-show'
    +   (w.noshow === 1 ? '' : 's') + ' this week'
    +   (w.adherence == null ? '' : ' · <b>' + w.adherence + '%</b> on time') + '.</div>'
    + '</section>';
}

/* the five worth a phone call, not all thirty */
function anTileCarriers(days){
  var all = anCarriers(days);
  var top = all.slice(0, 5);
  if(!top.length) return '';
  var worst = Math.max.apply(null, top.map(function(c){ return c.appts; }).concat([1]));
  var rows = top.map(function(c){
    var miss = c.appts - c.arrived;
    return '<div class="crow"><span class="cn" title="' + esc(c.carrier) + '">'
      + esc(c.carrier) + '</span>'
      + '<span class="cbar"><i class="c-arr" style="width:' + anPct(c.arrived, worst) + '%"></i>'
      +   '<i class="c-miss" style="width:' + anPct(miss, worst) + '%"></i></span>'
      + '<span class="cv">' + c.arrived + '/' + c.appts + '</span>'
      + '<span class="cp ' + (c.adherence == null ? '' : c.adherence >= 85 ? 'good'
          : c.adherence >= 70 ? 'due' : 'bad') + '">'
      +   (c.adherence == null ? '—' : c.adherence + '%') + '</span></div>';
  }).join('');
  return '<section class="btile c5"><div class="th"><b>Carriers to chase</b>'
    + (all.length > 5 ? '<button class="more" onclick="anListOpen(\'carriers\')">All '
        + all.length + ' →</button>' : '<span>worst first</span>') + '</div>'
    + '<div class="clist">' + rows + '</div>'
    + anKeyRow([{ n:top.reduce(function(a,c){ return a+c.arrived; },0), color:AN_C.done, label:'Arrived' },
                { n:top.reduce(function(a,c){ return a+(c.appts-c.arrived); },0),
                  color:AN_C.noshow, label:'Did not' }])
    + '</section>';
}

/* the actionable tile: who to ring, five at a time */
function anTileChase(days){
  var miss = [], soon = [];
  days.forEach(function(d){ d.rows.forEach(function(r){
    if(r.state === 'noshow') miss.push(r);
    else if(r.state === 'due') soon.push(r);
  }); });
  soon.sort(function(a,b){ return (a.appt||0) - (b.appt||0); });
  var showing = miss.length ? miss : soon;
  var kind = miss.length ? 'noshow' : 'due';
  var head = miss.length ? 'Did not show up' : 'Still to come';
  if(!showing.length){
    return '<section class="btile c5"><div class="th"><b>Nothing to chase</b></div>'
      + '<div class="waiting allgood">✓<span>Every appointment so far is accounted for.</span>'
      + '</div></section>';
  }
  var rows = showing.slice(0, 5).map(function(r){
    return '<div class="chrow"><span class="cht">' + (r.appt == null ? '—' : anHHMM(r.appt))
      + '</span><span class="chv"><b>' + esc(r.o.vendor || r.o.order) + '</b>'
      + '<em>' + esc(r.o.carrier || 'Carrier not stated') + '</em></span>'
      + '<span class="chn">' + (+r.o.cases||0).toLocaleString() + '<em>cases</em></span></div>';
  }).join('');
  return '<section class="btile c5 ' + (kind === 'noshow' ? 'alert' : '') + '">'
    + '<div class="th"><b>' + head + ' <span class="pillc ' + kind + '">' + showing.length
    +   '</span></b>'
    + (showing.length > 5 ? '<button class="more" onclick="anListOpen(\'' + kind + '\')">All '
        + showing.length + ' →</button>' : '') + '</div>'
    + '<div class="chlist">' + rows + '</div>'
    + '<div class="tf">' + (kind === 'noshow'
        ? 'Past due by more than ' + (AN_NOSHOW_MIN/60) + ' hours with no arrival.'
        : 'Booked, appointment not yet passed.') + '</div></section>';
}

/* ---- the long lists, on their own screen ---- */
function anListOpen(kind){ go('stats', false, kind); }
function anListClose(){ go('stats'); }
function anListSync(sub){
  var el = $('anlist'); if(!el) return;
  var kind = ['noshow','due','carriers'].indexOf(sub) >= 0 ? sub : '';
  if(!kind){ el.hidden = true; document.body.classList.remove('dayview-open'); return; }
  var days = anRangeDates().map(function(d){ return anRows(d); });
  $('anlist_title').textContent =
    kind === 'carriers' ? 'Carrier scorecard'
      : kind === 'noshow' ? 'Did not show up' : 'Still to come';
  $('anlist_body').innerHTML = kind === 'carriers' ? anFullCarriers(days) : anFullChase(days, kind);
  el.hidden = false;
  document.body.classList.add('dayview-open');
  var b = $('anlist_back'); if(b) b.focus();
}
function anFullCarriers(days){
  var list = anCarriers(days);
  return '<div class="antwrap"><table class="antab">'
    + '<tr><th>Carrier</th><th class="num">Appts</th><th class="num">Arrived</th>'
    +   '<th class="num">No-show</th><th class="num">Late</th><th class="num">On time</th>'
    +   '<th class="num">Turnaround</th></tr>'
    + list.map(function(c){
        var band = c.adherence == null ? '' : c.adherence >= 85 ? 'good'
          : c.adherence >= 70 ? 'due' : 'bad';
        return '<tr><td>' + esc(c.carrier) + '</td>'
          + '<td class="num">' + c.appts + '</td><td class="num">' + c.arrived + '</td>'
          + '<td class="num ' + (c.noshow ? 'bad' : '') + '">' + c.noshow + '</td>'
          + '<td class="num">' + c.late + '</td>'
          + '<td class="num ' + band + '">' + (c.adherence == null ? '—' : c.adherence + '%') + '</td>'
          + '<td class="num">' + anDur(c.turnAvg) + '</td></tr>';
      }).join('')
    + '</table></div>';
}
function anFullChase(days, kind){
  var rows = [];
  days.forEach(function(d){ d.rows.forEach(function(r){
    if(r.state === kind) rows.push(r); }); });
  rows.sort(function(a,b){ return (a.appt||0) - (b.appt||0); });
  return '<div class="antwrap"><table class="antab">'
    + '<tr><th>Appt</th><th>Order</th><th>Vendor</th><th>Carrier</th>'
    +   '<th class="num">Cases</th><th class="num">Pallets</th></tr>'
    + rows.map(function(r){
        return '<tr><td>' + (r.appt == null ? '—' : anHHMM(r.appt)) + '</td>'
          + '<td>' + esc(r.o.order) + '</td><td>' + esc(r.o.vendor) + '</td>'
          + '<td>' + esc(r.o.carrier) + '</td>'
          + '<td class="num">' + (+r.o.cases||0).toLocaleString() + '</td>'
          + '<td class="num">' + (+r.o.pallets||0) + '</td></tr>';
      }).join('')
    + '</table></div>';
}

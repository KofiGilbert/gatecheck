/* Checkpoint · https://gatecheck-martinbrower.netlify.app */

/* =================== TEAM MODE: login + shared data (Firebase) =================== */
/* Config is baked in at build time. Placeholder => app runs in local (single-device) mode. */
var FIREBASE_CONFIG = {
  apiKey: "AIzaSyDUVKtSOPnXFxlklzLc1Jn56gRf_dA-FvM",
  authDomain: "gatecheck-202a4.firebaseapp.com",
  projectId: "gatecheck-202a4",
  storageBucket: "gatecheck-202a4.firebasestorage.app",
  messagingSenderId: "986511247578",
  appId: "1:986511247578:web:ebb8aa1e3a070cd1df7de3",
  measurementId: "G-N25VKB2J4P"
};

var CLOUD = { ready:false, user:null, subs:[], db:null, role:'officer' };

function loginInert(on){
  var kids = document.body.children;
  for(var i=0;i<kids.length;i++){
    var el = kids[i];
    if(el.id==='login' || el.tagName==='SCRIPT') continue;
    if(on) el.setAttribute('inert',''); else el.removeAttribute('inert');
  }
}
function showLogin(){
  var o=$('login');
  /* the overlay is already up in its "checking" state on first paint, so
     "was hidden" means hidden OR still checking */
  var wasHidden = o.style.display==='none' || o.classList.contains('gc-checking');
  o.style.display='flex'; o.classList.remove('gc-checking'); loginInert(true);
  loginRecall();
  /* Nobody has signed in on this device yet, so the cursor starts in the
     email box. Once there are accounts to pick from, leave the keyboard
     down: tapping the box is what opens the list. */
  if(wasHidden && !loginKnown().length){
    var e=$('lg_email');
    if(e) setTimeout(function(){ e.focus(); },60);
  }
}
function hideLogin(){
  var o=$('login'); o.style.display='none'; o.classList.remove('gc-checking'); loginInert(false);
}
/* kind: undefined|'err' => error styling, 'ok' => success styling */
function loginErr(m, kind){
  var e=$('loginerr'); if(!e) return;
  e.textContent = m || '';
  e.className = m ? (kind==='ok'?'ok':'') : '';
}
/* Firebase error code -> plain-language message with a next step */
function authErrText(e, ctx){
  var bad = "That email and password don't match. Check for typos \u2014 then try again, "
          + 'or tap "Forgot your password?" below.';
  var map = {
    'auth/invalid-credential': bad,
    'auth/invalid-login-credentials': bad,
    'auth/invalid-email-or-password': bad,
    'auth/wrong-password': bad,
    'auth/user-not-found': bad,
    'auth/missing-password': 'Enter your password to sign in.',
    'auth/invalid-email': ctx==='reset'
      ? "That doesn't look like a complete email address. Check it and tap \"Forgot your password?\" again."
      : "That doesn't look like a complete email address. It needs an @ and a domain, like name@example.com.",
    'auth/user-disabled': 'This account has been turned off. Ask your admin to turn it back on.',
    'auth/too-many-requests': ctx==='reset'
      ? 'Too many reset requests. Wait a few minutes, then try again.'
      : 'Too many sign-in attempts. Wait about a minute and try again. Resetting your password also unlocks the account right away.',
    'auth/network-request-failed': ctx==='reset'
      ? "No connection. Checkpoint can't send the reset email right now. Check your signal and try again."
      : "No connection. Checkpoint can't reach the server. Check your Wi-Fi or cell signal, then try again."
  };
  if(map[e.code]) return map[e.code];
  return ctx==='reset'
    ? "We couldn't send the reset email. Try again in a moment, or ask your admin to reset it for you."
    : 'Something went wrong on our end. Try again in a moment. If it keeps happening, give your admin this code: '+(e.code||e.message);
}

function cloudInit(){
  /* the overlay covers the app from first paint; keep the app behind it
     unreachable while we wait for Firebase to report an auth state */
  var _lg = $('login');
  if(_lg && _lg.classList.contains('gc-checking')) loginInert(true);
  /* if auth never reports back, fall through to the form rather than
     leaving the officer staring at a spinner */
  setTimeout(function(){
    if(!CLOUD.user && _lg && _lg.classList.contains('gc-checking')) showLogin();
  }, 8000);
  if(FIREBASE_CONFIG.__PLACEHOLDER__ || typeof firebase==='undefined'){
    hideLogin();
    $('datastat').textContent = 'Single-device mode (team login not set up yet)';
    setTimeout(stat, 400); // let normal stat() take over once data loads
    return;
  }
  try{
    firebase.initializeApp(FIREBASE_CONFIG);
    CLOUD.db = firebase.firestore();
    try{ CLOUD.db.enablePersistence({synchronizeTabs:true}).catch(function(){}); }catch(e){}
    firebase.auth().onAuthStateChanged(function(u){
      CLOUD.user = u;
      if(u){
        CLOUD.ready = true;
        /* so the next refresh does not flash the login screen at them */
        sset('gc_wasin', '1');
        /* and so signing in again is a password, not a whole address typed
           on a tablet keyboard. iCloud Keychain may or may not have offered
           to save it; this does not depend on whether it did. */
        if(u.email) loginRemember(u.email);
        /* apply the role we saw last time so there is no flash, then let the
           account document confirm or correct it */
        setRole(sget('gc_role_'+u.email) || 'officer');
        hideLogin(); loginErr('');
        var _w=$('whoami'); if(_w) _w.textContent = u.email;
        var _s=$('signout'); if(_s) _s.style.display = 'inline-block';
        if(typeof menuFill==='function') menuFill();
        startSync();
      } else {
        CLOUD.ready = false;
        sset('gc_wasin', '');
        stopSync();
        var _w2=$('whoami'); if(_w2) _w2.textContent = '';
        var _s2=$('signout'); if(_s2) _s2.style.display = 'none';
        if(typeof closeMenu==='function') closeMenu();
        showLogin();
      }
    });
  }catch(e){
    toast('Cloud setup problem: '+e.message+'. Running in single-device mode.');
  }
}
/* The email box comes back filled in with whoever used this device last, and
   the cursor starts on the password. Signing out is not the same as saying
   "forget me": the office iPad is used by the office. */
function loginKnown(){
  try{
    var raw = sget('gc_emails');
    var list = raw ? JSON.parse(raw) : [];
    if(Array.isArray(list)) return list.filter(function(e){ return typeof e === 'string' && e; });
  }catch(e){}
  /* whatever the older single-address version left behind */
  var one = sget('gc_lastemail');
  return one ? [one] : [];
}
function loginRemember(email){
  email = String(email || '').trim();
  if(!email) return;
  var list = loginKnown().filter(function(e){ return e.toLowerCase() !== email.toLowerCase(); });
  list.unshift(email);
  try{ sset('gc_emails', JSON.stringify(list.slice(0, 6))); }catch(e){}
  sset('gc_lastemail', email);
}
function loginForgetOne(email, ev){
  if(ev){ ev.preventDefault(); ev.stopPropagation(); }
  var list = loginKnown().filter(function(e){ return e !== email; });
  try{ sset('gc_emails', JSON.stringify(list)); }catch(e){}
  if(sget('gc_lastemail') === email) sset('gc_lastemail', list[0] || '');
  var box = $('lg_email');
  if(box && box.value === email) box.value = '';
  loginSuggest(true);
  if(box) box.focus();
}
function loginPick(email){
  var box = $('lg_email'); if(box) box.value = email;
  loginSuggestHide();
  var pw = $('lg_pass'); if(pw){ pw.value = ''; try{ pw.focus(); }catch(e){} }
}
function loginSuggestHide(){
  var el = $('lg_sugg'); if(el){ el.hidden = true; el.innerHTML = ''; }
}
/* Tapping the box shows everyone who has signed in on this device; typing
   narrows it. A laptop browser does this out of its own form history, and
   iOS Safari does not, so the app draws it.

   `all` is true when the box was tapped rather than typed into: then the
   whole list shows even if the box already holds one of the addresses,
   which is the case that made this look broken on the iPad. */
function loginSuggest(all){
  var el = $('lg_sugg'), box = $('lg_email');
  if(!el || !box) return;
  var typed = String(box.value || '').trim().toLowerCase();
  var known = loginKnown();
  var list = (all || !typed) ? known : known.filter(function(e){
    return e.toLowerCase().indexOf(typed) >= 0;
  });
  if(!list.length){ loginSuggestHide(); return; }
  el.innerHTML = list.map(function(e){
    var q = String(e).replace(/'/g, "\\'");
    return '<div class="gc-sugg-row" role="option" aria-selected="false">'
      + '<button type="button" class="gc-sugg-pick" onclick="loginPick(\''+q+'\')">'
      +   '<i aria-hidden="true">\u2709</i><span>'+esc(e)+'</span></button>'
      + '<button type="button" class="gc-sugg-x" aria-label="Forget '+esc(e)+'"'
      +   ' onclick="loginForgetOne(\''+q+'\', event)">\u2715</button>'
      + '</div>';
  }).join('');
  el.hidden = false;
}
/* The box is left empty on purpose. Filling it in for somebody hides the
   list of the other accounts behind it, and on a shared office iPad the
   other accounts are the point. One tap picks; the password is always
   asked for, and never stored. */
function loginRecall(){
  var el = $('lg_sugg');
  if(el) el.hidden = true;
}
document.addEventListener('click', function(e){
  var el = $('lg_sugg');
  if(!el || el.hidden) return;
  if(el.contains(e.target) || e.target === $('lg_email')) return;
  loginSuggestHide();
});
document.addEventListener('keydown', function(e){
  if(e.key === 'Escape') loginSuggestHide();
});
(function(){
  var box = $('lg_email'); if(!box) return;
  box.addEventListener('focus', function(){ loginSuggest(true); });
  box.addEventListener('click', function(){ loginSuggest(true); });
  box.addEventListener('input', function(){ loginSuggest(false); });
})();
function doLogin(){
  var em=$('lg_email').value.trim(), pw=$('lg_pass').value;
  if(!em||!pw){ loginErr('Enter your email and password to sign in.'); return; }
  loginErr(''); $('lg_btn').disabled=true;
  firebase.auth().signInWithEmailAndPassword(em,pw)
    .catch(function(e){ loginErr(authErrText(e,'login')); })
    .finally(function(){ $('lg_btn').disabled=false; });
}
function doReset(){
  var em=$('lg_email').value.trim();
  if(!em){
    loginErr('Type your email in the box above first, then tap "Forgot your password?".');
    $('lg_email').focus(); return;
  }
  firebase.auth().sendPasswordResetEmail(em)
    .then(function(){
      loginErr('Check your email. We sent a reset link to '+em+'. The link works for one hour.','ok');
    })
    .catch(function(e){ loginErr(authErrText(e,'reset')); });
}
/* ---- role: officer on the gate, or the receiving office ---- */
function setRole(role){
  role = (role === 'office') ? 'office' : 'officer';
  CLOUD.role = role;
  var em = (CLOUD.user && CLOUD.user.email) || '';
  if(em) sset('gc_role_'+em, role);
  if(typeof applyRole === 'function') applyRole();
}

function doSignOut(){ if(CLOUD.ready||CLOUD.user) firebase.auth().signOut(); }

/* ---- receiving office: releasing a trailer block ---- */
function blockCloudSave(entry){
  if(!CLOUD.ready || !entry || !entry.id) return;
  CLOUD.db.collection('yardslots').doc(entry.id).set(entry)
    .catch(function(e){ toast('Could not release: '+e.message); });
}

/* ---- gate log: shared with the team ---- */
function logCloudAdd(r){
  if(!CLOUD.ready || !r || !r.id) return;
  CLOUD.db.collection('logs').doc(r.id).set(r, {merge:true})
    .catch(function(e){ toast('Log not shared: '+e.message); });
}
var _logTimers = {};
function logCloudSet(r){
  if(!CLOUD.ready || !r || !r.id) return;
  /* the officer types into Time Out and Out Trailer, so hold off until they stop */
  clearTimeout(_logTimers[r.id]);
  _logTimers[r.id] = setTimeout(function(){
    CLOUD.db.collection('logs').doc(r.id)
      .set(r.manual
        ? { timein:r.timein||'', timeout:r.timeout||'', carrier:r.carrier||'',
            tractor:r.tractor||'', trailer:r.trailer||'', outtrailer:r.outtrailer||'',
            plate:r.plate||'', state:r.state||'', notes:r.notes||'',
            outBy:r.outBy||'', outByName:r.outByName||'', outAt:r.outAt||'' }
        : { timeout:r.timeout||'', outtrailer:r.outtrailer||'',
            outBy:r.outBy||'', outByName:r.outByName||'', outAt:r.outAt||'' }, {merge:true})
      .catch(function(e){ toast('Log not saved: '+e.message); });
  }, 700);
}

function startSync(){
  stopSync();
  var db=CLOUD.db;
  CLOUD.subs.push(db.collection('orders').onSnapshot(function(snap){
    /* the office's copy, which is the one the yard works from. Anything an
       officer loaded here for a day the office has now sent is set against it
       and then retired - it must never be quietly overwritten, because they
       may have been working from it. */
    DB.office = snap.docs.map(function(d){ return d.data(); });
    schedReconcile();
    schedRebuild();
    persist(); stat(); renderSched(); doSearch();
    /* the officer keeps working; the bell tells them when they look at it */
    if(typeof ycUpdateBadge === 'function') ycUpdateBadge();
    if(typeof routeResync==='function') routeResync();
  }, function(e){ toast('Sync error: '+e.message); }));
  CLOUD.subs.push(db.collection('forms').orderBy('ts','desc').limit(200).onSnapshot(function(snap){
    DB.forms = snap.docs.map(function(d){ var o=d.data(); o._id=d.id; return o; });
    persist(); renderHist();
    /* a truck at the gate joins the office's queue the moment its form lands */
    if(typeof renderQueue==='function'){ renderQueue(); queueTileSync(); }
  }, function(e){}));
  CLOUD.subs.push(db.collection('logs').orderBy('ts','desc').limit(300).onSnapshot(function(snap){
    /* rows written before the gate log stored ISO come back in the old form */
    DB.logs = logMigrate(snap.docs.map(function(d){ return d.data(); }));
    if(typeof logPersist==='function'){ logPersist();
      /* never redraw the sheet out from under a cursor: the snapshot arrives
         while the officer is still typing into the row that caused it */
      var typing = document.activeElement && document.activeElement.closest
        && document.activeElement.closest('#logrows');
      if(!typing && $('sec-log') && $('sec-log').classList.contains('on')) renderLog(); }
  }, function(e){}));
  /* the receiving office writes one record per slot when it loads the trailer block */
  CLOUD.subs.push(db.collection('yardslots').orderBy('date','desc').limit(120).onSnapshot(function(snap){
    DB.yardslots = snap.docs.map(function(d){ return d.data(); });
    if(typeof ycSlotsPersist==='function'){ ycSlotsPersist();
      /* tell the officer as soon as the office makes one available */
      if(typeof ycNotifyReady==='function') ycNotifyReady();
      if($('sec-yard') && $('sec-yard').classList.contains('on')) renderYardSlots(); }
  }, function(e){}));
  CLOUD.subs.push(db.collection('yardchecks').orderBy('ts','desc').limit(60).onSnapshot(function(snap){
    DB.yardchecks = snap.docs.map(function(d){ var o=d.data(); o._id=d.id; return o; });
    if(typeof ycPersistAll==='function'){ ycPersistAll(); renderYardHist(); }
    /* a check the officer has just filed rings the office's bell */
    if(typeof ycUpdateBadge==='function') ycUpdateBadge();
    /* the board is the office's screen; an officer has no business drawing it */
    if(typeof isOffice==='function' && isOffice() && typeof blockRender==='function') blockRender();
    if(typeof routeResync==='function') routeResync();
  }, function(e){}));
  var _em = CLOUD.user.email;
  CLOUD.subs.push(db.collection('officers').doc(_em).onSnapshot(function(doc){
    var d = (doc.exists && doc.data()) || {};
    var nm = d.name||'';
    if(nm){ sset('gc_offname_'+_em, nm);
      var i=$('set_offname'); if(i && document.activeElement!==i) i.value=nm;
      var v=$('f_verified'); if(v && !v.value) v.value=nm; }
    /* the role comes from the account, never from anything the user picks */
    setRole(d.role === 'office' ? 'office' : 'officer');
  }, function(e){}));
  CLOUD.subs.push(db.collection('settings').doc('app').onSnapshot(function(doc){
    var d = doc.exists? doc.data():{};
    var v = d.officeEmail||'';
    sset('gc_email', v);
    var e=$('set_email'); if(e && document.activeElement!==e) e.value=v;
    var mu = d.mailerUrl||'';
    sset('gc_mailer', mu);
    var m=$('set_mailer'); if(m && document.activeElement!==m) m.value=mu;
    var cc = d.ccEmails||'';
    sset('gc_cc', cc);
    var c=$('set_cc'); if(c && document.activeElement!==c) c.value=cc;
  }, function(e){}));
}
function stopSync(){ CLOUD.subs.forEach(function(u){ try{u();}catch(e){} }); CLOUD.subs=[]; }

/* ---- route existing actions through the cloud when signed in ---- */
var _localMergeOrders = mergeOrders;
mergeOrders = function(arr){
  if(!CLOUD.ready){ _localMergeOrders(arr); return; }
  /* Only the receiving office may write the team's schedule - that is in the
     Firestore rules, and it is right: one authority for what the yard works
     from. An officer's own copy is kept on their device instead of being
     sent and silently refused. */
  if(typeof isOffice === 'function' && !isOffice()){
    _localMergeOrders(arr);
    toast('Loaded on this device. The receiving office sends it to the team.');
    return;
  }
  var list=arr.map(normalizeRow).filter(function(n){ return n.order; });
  if(!list.length){ toast('Nothing to import'); return; }
  var db=CLOUD.db, done=0;
  for(var i=0;i<list.length;i+=400){
    var b=db.batch();
    list.slice(i,i+400).forEach(function(o){
      o.updatedBy=CLOUD.user.email;
      b.set(db.collection('orders').doc(o.date+'_'+o.order), o);
    });
    b.commit().then(function(){});
    done+=Math.min(400,list.length-i);
  }
  toast('Imported '+list.length+' orders, shared with the whole team.');
};
/* An edited day is published whole: rows the office removed are deleted from
   the shared schedule, not just dropped from this browser. */
var _localPublishDay = publishDay;
publishDay = function(date, rows){
  var list = rows.map(normalizeRow).filter(function(r){ return r.order; });
  var keep = {}; list.forEach(function(r){ keep[r.date+'_'+r.order] = 1; });
  var gone = DB.orders.filter(function(o){ return o.date === date; })
    .map(function(o){ return o.date+'_'+o.order; })
    .filter(function(id){ return !keep[id]; });
  _localPublishDay(date, rows);
  if(!CLOUD.ready) return;
  var db = CLOUD.db, ops = [];
  list.forEach(function(o){
    o.updatedBy = CLOUD.user.email;
    ops.push(['set', db.collection('orders').doc(o.date+'_'+o.order), o]);
  });
  gone.forEach(function(id){ ops.push(['del', db.collection('orders').doc(id)]); });
  for(var i=0;i<ops.length;i+=400){
    var b = db.batch();
    ops.slice(i,i+400).forEach(function(op){
      if(op[0]==='set') b.set(op[1], op[2]); else b.delete(op[1]);
    });
    b.commit();
  }
};
function logCloudDel(id){
  if(!CLOUD.ready || !id) return;
  CLOUD.db.collection('logs').doc(id).delete()
    .catch(function(e){ toast('Row not removed: '+e.message); });
}
/* One day removed for everyone. The snapshot brings the shortened schedule
   back, so nothing is deleted locally that did not leave the server. */
var _localDropDay = schedDropDay;
schedDropDay = function(date, when){
  if(!CLOUD.ready){ _localDropDay(date, when); return; }
  var db = CLOUD.db;
  var ids = DB.orders.filter(function(o){ return o.date === date; })
                     .map(function(o){ return o.date+'_'+o.order; });
  /* go from this screen straight away; if the write is refused, the snapshot
     puts the day back rather than leaving the office looking at a lie */
  _localDropDay(date, when,
    'Deleted ' + (when || date) + ' for the team. Load it again when you have a good copy.');
  for(var i=0;i<ids.length;i+=400){
    var b = db.batch();
    ids.slice(i,i+400).forEach(function(id){ b.delete(db.collection('orders').doc(id)); });
    b.commit().catch(function(e){ toast('Day not removed: '+e.message); });
  }
};
var _localClearAll = clearAll;
clearAll = function(){
  if(!CLOUD.ready){ _localClearAll(); return; }
  if(!confirm('Delete the schedule for EVERYONE on the team? Saved forms are kept.')) return;
  var db=CLOUD.db, ids=DB.orders.map(function(o){ return o.date+'_'+o.order; });
  for(var i=0;i<ids.length;i+=400){
    var b=db.batch();
    ids.slice(i,i+400).forEach(function(id){ b.delete(db.collection('orders').doc(id)); });
    b.commit();
  }
  toast('Schedule cleared for the team');
};
var _localSaveForm = saveForm;
saveForm = function(){
  if(!CLOUD.ready){ _localSaveForm(); return; }
  var d = collect();
  if(!d.po){ toast('PO / Order number is empty'); return; }
  d.createdBy = CLOUD.user.email;
  CLOUD.db.collection('forms').add(d)
    .then(function(){})
    .catch(function(e){ toast('Could not save: '+e.message); });
  toast('Form saved ✔. Visible to the whole team.');
};
var _localDelHist = delHist;
delHist = function(i){
  if(!CLOUD.ready){ _localDelHist(i); return; }
  var f=DB.forms[i];
  if(!f||!f._id){ _localDelHist(i); return; }
  if(!confirm('Delete this saved form for everyone?')) return;
  CLOUD.db.collection('forms').doc(f._id).delete();
};
/* shared office email */
(function(){
  var e=$('set_email'); if(e) e.addEventListener('change', function(){
    if(CLOUD.ready) CLOUD.db.collection('settings').doc('app')
      .set({officeEmail:e.value.trim()},{merge:true});
  });
  var m=$('set_mailer'); if(m) m.addEventListener('change', function(){
    if(CLOUD.ready) CLOUD.db.collection('settings').doc('app')
      .set({mailerUrl:m.value.trim()},{merge:true});
  });
  var c=$('set_cc'); if(c) c.addEventListener('change', function(){
    if(CLOUD.ready) CLOUD.db.collection('settings').doc('app')
      .set({ccEmails:c.value.trim()},{merge:true});
  });
})();
/* show who filled each saved form */
var _renderHist = renderHist;
renderHist = function(){
  _renderHist();
  if(!DB.forms.some(function(f){return f.createdBy;})) return;
  var items=document.querySelectorAll('#hist .histitem .t2');
  DB.forms.forEach(function(f,i){
    if(f.createdBy && items[i] && items[i].textContent.indexOf(f.createdBy)<0)
      items[i].textContent += ' · by '+f.createdBy.split('@')[0];
  });
};
/* ---- sign-in screen affordances ---- */
(function(){
  var pw=$('lg_pass'), rv=$('lg_reveal'), caps=$('lg_caps'), foot=$('lg_foot');
  if(rv && pw) rv.addEventListener('click', function(){
    var show = pw.type==='password';
    pw.type = show? 'text':'password';
    rv.textContent = show? 'Hide':'Show';
    rv.setAttribute('aria-pressed', show? 'true':'false');
    rv.setAttribute('aria-label', show? 'Hide password':'Show password');
    var n = pw.value.length;
    pw.focus(); try{ pw.setSelectionRange(n,n); }catch(e){}
  });
  if(pw && caps){
    var chk = function(ev){
      var on = ev.getModifierState && ev.getModifierState('CapsLock');
      caps.classList.toggle('on', !!on);
    };
    pw.addEventListener('keydown', chk);
    pw.addEventListener('keyup', chk);
    pw.addEventListener('blur', function(){ caps.classList.remove('on'); });
  }
  if(foot){
    var base = foot.textContent;
    var net = function(){
      foot.textContent = navigator.onLine? base : 'No connection \u2014 check Wi-Fi or signal';
    };
    window.addEventListener('online', net);
    window.addEventListener('offline', net);
    net();
  }
})();

cloudInit();

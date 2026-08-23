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
  if(wasHidden){ var e=$('lg_email'); if(e && !e.value) setTimeout(function(){ e.focus(); },60); }
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
      .set({ timeout:r.timeout||'', outtrailer:r.outtrailer||'',
             outBy:r.outBy||'', outByName:r.outByName||'', outAt:r.outAt||'' }, {merge:true})
      .catch(function(e){ toast('Log not saved: '+e.message); });
  }, 700);
}

function startSync(){
  stopSync();
  var db=CLOUD.db;
  CLOUD.subs.push(db.collection('orders').onSnapshot(function(snap){
    DB.orders = snap.docs.map(function(d){ return d.data(); });
    DB.orders.sort(function(a,b){ return a.date<b.date?-1:a.date>b.date?1:(a.zone<b.zone?-1:1); });
    persist(); stat(); renderSched(); doSearch();
    if(typeof routeResync==='function') routeResync();
  }, function(e){ toast('Sync error: '+e.message); }));
  CLOUD.subs.push(db.collection('forms').orderBy('ts','desc').limit(200).onSnapshot(function(snap){
    DB.forms = snap.docs.map(function(d){ var o=d.data(); o._id=d.id; return o; });
    persist(); renderHist();
  }, function(e){}));
  CLOUD.subs.push(db.collection('logs').orderBy('ts','desc').limit(300).onSnapshot(function(snap){
    /* rows written before the gate log stored ISO come back in the old form */
    DB.logs = logMigrate(snap.docs.map(function(d){ return d.data(); }));
    if(typeof logPersist==='function'){ logPersist();
      if($('sec-log') && $('sec-log').classList.contains('on')) renderLog(); }
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

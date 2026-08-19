/* Gate Check — https://gatecheck-martinbrower.netlify.app */

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

var CLOUD = { ready:false, user:null, subs:[], db:null };

function showLogin(){ $('login').style.display='flex'; }
function hideLogin(){ $('login').style.display='none'; }
function loginErr(m){ $('loginerr').textContent = m||''; }

function cloudInit(){
  if(FIREBASE_CONFIG.__PLACEHOLDER__ || typeof firebase==='undefined'){
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
        hideLogin(); loginErr('');
        $('whoami').textContent = u.email;
        $('signout').style.display = 'inline-block';
        startSync();
      } else {
        CLOUD.ready = false;
        stopSync();
        $('whoami').textContent = '';
        $('signout').style.display = 'none';
        showLogin();
      }
    });
  }catch(e){
    toast('Cloud setup problem: '+e.message+' — running in single-device mode');
  }
}
function doLogin(){
  var em=$('lg_email').value.trim(), pw=$('lg_pass').value;
  if(!em||!pw){ loginErr('Enter your email and password.'); return; }
  loginErr(''); $('lg_btn').disabled=true;
  firebase.auth().signInWithEmailAndPassword(em,pw)
    .catch(function(e){
      var m = {'auth/invalid-credential':'Wrong email or password.',
               'auth/user-not-found':'No account with that email — ask your admin.',
               'auth/wrong-password':'Wrong password.',
               'auth/too-many-requests':'Too many tries — wait a minute and try again.',
               'auth/network-request-failed':'No internet connection.'}[e.code] || e.message;
      loginErr(m);
    })
    .finally(function(){ $('lg_btn').disabled=false; });
}
function doReset(){
  var em=$('lg_email').value.trim();
  if(!em){ loginErr('Type your email first, then tap "Forgot password".'); return; }
  firebase.auth().sendPasswordResetEmail(em)
    .then(function(){ loginErr('Password reset email sent — check your inbox.'); })
    .catch(function(e){ loginErr(e.message); });
}
function doSignOut(){ if(CLOUD.ready||CLOUD.user) firebase.auth().signOut(); }

function startSync(){
  stopSync();
  var db=CLOUD.db;
  CLOUD.subs.push(db.collection('orders').onSnapshot(function(snap){
    DB.orders = snap.docs.map(function(d){ return d.data(); });
    DB.orders.sort(function(a,b){ return a.date<b.date?-1:a.date>b.date?1:(a.zone<b.zone?-1:1); });
    persist(); stat(); renderSched(); doSearch();
  }, function(e){ toast('Sync error: '+e.message); }));
  CLOUD.subs.push(db.collection('forms').orderBy('ts','desc').limit(200).onSnapshot(function(snap){
    DB.forms = snap.docs.map(function(d){ var o=d.data(); o._id=d.id; return o; });
    persist(); renderHist();
  }, function(e){}));
  CLOUD.subs.push(db.collection('yardchecks').orderBy('ts','desc').limit(60).onSnapshot(function(snap){
    DB.yardchecks = snap.docs.map(function(d){ var o=d.data(); o._id=d.id; return o; });
    if(typeof ycPersistAll==='function'){ ycPersistAll(); renderYardHist(); }
  }, function(e){}));
  var _em = CLOUD.user.email;
  CLOUD.subs.push(db.collection('officers').doc(_em).onSnapshot(function(doc){
    var nm=(doc.exists && doc.data().name)||'';
    if(nm){ sset('gc_offname_'+_em, nm);
      var i=$('set_offname'); if(i && document.activeElement!==i) i.value=nm;
      var v=$('f_verified'); if(v && !v.value) v.value=nm; }
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
  toast('Imported '+list.length+' orders — shared with the whole team');
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
  toast('Form saved ✔ — visible to the whole team');
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
cloudInit();

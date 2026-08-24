/* ===================== how the app looks and behaves =====================
   Four settings, and each one is here because of how this app is actually
   used, not because a settings screen looked empty:

     Appearance    half the workforce is on 6pm-6am. A white screen at 3am in
                   a gatehouse is a genuine complaint, not a preference.
     Text size     read at arm's length, outdoors, in gloves, often by someone
                   who does not have their reading glasses on them.
     Sound         a confirmation you can hear means not having to look back
                   at the screen to know a form went.
     Screen awake  an officer works the gate log for an hour at a time. A
                   screen that keeps sleeping is a screen they keep waking.

   Every one of them is off or neutral by default except the theme, which
   follows the device.
*/

var PREFS = { theme:'system', size:'normal', sound:true, awake:false };

function prefsLoad(){
  try{
    var raw = sget('gc_prefs');
    if(raw){
      var p = JSON.parse(raw);
      if(p && typeof p === 'object'){
        if(p.theme) PREFS.theme = p.theme;
        if(p.size)  PREFS.size  = p.size;
        if(typeof p.sound === 'boolean') PREFS.sound = p.sound;
        if(typeof p.awake === 'boolean') PREFS.awake = p.awake;
      }
    }
  }catch(e){}
  prefsApply();
}
function prefsSave(){
  try{ sset('gc_prefs', JSON.stringify(PREFS)); }catch(e){}
  prefsApply();
  prefsRender();
}
function prefsSet(k, v){
  PREFS[k] = v;
  prefsSave();
  if(k === 'awake') wakeApply();
  if(k === 'sound' && v) beep();
}

var SIZE_SCALE = { normal:1, large:1.12, larger:1.25 };
function prefsApply(){
  var r = document.documentElement;
  r.setAttribute('data-theme', PREFS.theme === 'system' ? '' : PREFS.theme);
  if(PREFS.theme === 'system') r.removeAttribute('data-theme');
  r.style.setProperty('--ui-scale', String(SIZE_SCALE[PREFS.size] || 1));
  /* the browser chrome follows the app, so a dark app is dark to its edges */
  var m = document.querySelector('meta[name="theme-color"]');
  if(m) m.setAttribute('content', prefsDark() ? '#0B1117' : '#000E19');
}
function prefsDark(){
  if(PREFS.theme === 'dark') return true;
  if(PREFS.theme === 'light') return false;
  try{ return window.matchMedia('(prefers-color-scheme: dark)').matches; }catch(e){ return false; }
}

/* ---- a sound you do not have to look up for ---- */
var _ac = null;
function beep(ok){
  if(!PREFS.sound) return;
  try{
    _ac = _ac || new (window.AudioContext || window.webkitAudioContext)();
    if(_ac.state === 'suspended') _ac.resume();
    var o = _ac.createOscillator(), g = _ac.createGain();
    o.type = 'sine';
    o.frequency.value = (ok === false) ? 320 : 880;
    g.gain.setValueAtTime(0.0001, _ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.16, _ac.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, _ac.currentTime + 0.18);
    o.connect(g); g.connect(_ac.destination);
    o.start(); o.stop(_ac.currentTime + 0.2);
  }catch(e){}
  /* a phone that can buzz, buzzes too; an iPad simply will not, and that is
     fine - the sound is the part that works everywhere */
  try{ if(navigator.vibrate) navigator.vibrate(ok === false ? [60,40,60] : 25); }catch(e){}
}

/* ---- the screen stays on while the officer is working ---- */
var _wake = null;
function wakeApply(){
  if(!('wakeLock' in navigator)) return;
  if(PREFS.awake && document.visibilityState === 'visible'){
    if(_wake) return;
    navigator.wakeLock.request('screen').then(function(l){
      _wake = l;
      l.addEventListener('release', function(){ _wake = null; });
    }).catch(function(){ _wake = null; });
  } else if(_wake){
    try{ _wake.release(); }catch(e){}
    _wake = null;
  }
}
document.addEventListener('visibilitychange', wakeApply);

/* ---- installing it as an app ---- */
var _install = null;
window.addEventListener('beforeinstallprompt', function(e){
  e.preventDefault();
  _install = e;
  prefsRender();
});
window.addEventListener('appinstalled', function(){ _install = null; prefsRender(); });
function prefsInstalled(){
  try{
    return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
  }catch(e){ return false; }
}
function prefsInstall(){
  if(!_install) return;
  _install.prompt();
  _install.userChoice.then(function(){ _install = null; prefsRender(); });
}

/* ---- the settings screen ---- */
function prefsSeg(k, opts){
  return '<div class="pseg" role="group">' + opts.map(function(o){
    return '<button type="button" class="pseg-b'+(PREFS[k]===o[0]?' on':'')+'"'
      + ' aria-pressed="'+(PREFS[k]===o[0])+'"'
      + ' onclick="prefsSet(\''+k+'\',\''+o[0]+'\')">'+esc(o[1])+'</button>';
  }).join('') + '</div>';
}
function prefsSwitch(k, label, note){
  return '<div class="prow"><div class="ptext"><b>'+esc(label)+'</b>'
    + (note ? '<span>'+esc(note)+'</span>' : '') + '</div>'
    + '<button type="button" class="pswitch'+(PREFS[k]?' on':'')+'" role="switch"'
    + ' aria-checked="'+(!!PREFS[k])+'" aria-label="'+esc(label)+'"'
    + ' onclick="prefsSet(\''+k+'\','+(PREFS[k]?'false':'true')+')"><i></i></button></div>';
}
function prefsRender(){
  var host = $('prefsbody'); if(!host) return;
  var canWake = ('wakeLock' in navigator);
  host.innerHTML =
      '<div class="prow col"><div class="ptext"><b>Appearance</b>'
    +   '<span>Dark is easier on a night shift. Match device follows your '
    +   'phone or iPad.</span></div>'
    +   prefsSeg('theme', [['light','Light'], ['dark','Dark'], ['system','Match device']])
    + '</div>'
    + '<div class="prow col"><div class="ptext"><b>Text size</b>'
    +   '<span>Bigger type for reading at arm’s length, outdoors, in gloves.</span></div>'
    +   prefsSeg('size', [['normal','Normal'], ['large','Large'], ['larger','Larger']])
    + '</div>'
    + prefsSwitch('sound', 'Sound on save',
        'A short tone when a form goes, so you know without looking back.')
    + (canWake
        ? prefsSwitch('awake', 'Keep the screen awake',
            'While Checkpoint is open. Uses more battery.')
        : '<div class="prow"><div class="ptext"><b>Keep the screen awake</b>'
          + '<span>This browser cannot hold the screen on. Open Checkpoint from '
          + 'the home screen, or set the screen timeout on the device.</span></div></div>')
    + prefsInstallRow();
}
function prefsInstallRow(){
  if(prefsInstalled())
    return '<div class="prow"><div class="ptext"><b>Installed</b>'
      + '<span>Checkpoint is running as an app on this device.</span></div>'
      + '<span class="pdone">✓</span></div>';
  if(_install)
    return '<div class="prow"><div class="ptext"><b>Install Checkpoint</b>'
      + '<span>Puts it on the home screen and opens it without the browser bars.</span>'
      + '</div><button type="button" class="pinstall" onclick="prefsInstall()">Install</button></div>';
  return '<div class="prow"><div class="ptext"><b>Install Checkpoint</b>'
    + '<span>On an iPhone or iPad: the Share button, then “Add to Home Screen”.</span>'
    + '</div></div>';
}

/* the shell is kept on the device so a bad signal in the yard is not a blank
   screen; the data behind it comes from Firestore's own offline copy */
if('serviceWorker' in navigator && location.protocol !== 'file:'){
  window.addEventListener('load', function(){
    navigator.serviceWorker.register('sw.js').catch(function(){});
  });
}
prefsLoad();

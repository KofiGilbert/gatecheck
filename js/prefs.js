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

var PREFS = { theme:'system', size:'normal', sound:true, tap:true, awake:false,
              handocr:true, popup:false };

function prefsLoad(){
  try{
    var raw = sget('gc_prefs');
    if(raw){
      var p = JSON.parse(raw);
      if(p && typeof p === 'object'){
        if(p.theme) PREFS.theme = p.theme;
        if(p.size)  PREFS.size  = p.size;
        if(typeof p.sound === 'boolean') PREFS.sound = p.sound;
        if(typeof p.tap === 'boolean') PREFS.tap = p.tap;
        if(typeof p.awake === 'boolean') PREFS.awake = p.awake;
        if(typeof p.handocr === 'boolean') PREFS.handocr = p.handocr;
        if(typeof p.popup === 'boolean') PREFS.popup = p.popup;
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
  /* The browser is asked here and nowhere else. Asking on load is what every
     guide tells you not to do - browsers are moving to refuse a request that
     is not answering a tap, and it trains people to hit Block on sight. This
     is the tap. */
  if(k === 'popup' && v && 'Notification' in window){
    try{
      Notification.requestPermission().then(function(res){
        if(res !== 'granted'){
          PREFS.popup = false;
          try{ sset('gc_prefs', JSON.stringify(PREFS)); }catch(e){}
          prefsRender();
          toast(res === 'denied'
            ? 'Pop-ups are blocked for this site. Turn them on in the browser\'s site settings.'
            : 'Pop-ups were not allowed.');
        }
      });
    }catch(e){}
  }
  if(k === 'sound' && v) beep('notify');
  if(k === 'tap' && v) beep('tap');
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

/* ---- a sound you do not have to look up for ----
   Three of them, and they have to be told apart without thinking: a save is
   one note, a refusal is a low one, and the bell is two rising notes so it is
   never mistaken for a form having gone. Nothing here runs longer than a third
   of a second, which keeps it clear of the three-second mark where WCAG asks
   for a stop control - and the switch in Settings is the stop control anyway. */
var _ac = null;
function beep(kind){
  /* the tap has its own switch: it happens on every press, which is a very
     different thing to agree to than a tone when a form goes */
  if(!(kind === 'tap' ? PREFS.tap : PREFS.sound)) return;
  try{
    _ac = _ac || new (window.AudioContext || window.webkitAudioContext)();
    /* a browser will not make a sound until the person has touched the page;
       the first tap of the session is what wakes this up - and now that every
       press ticks, that really is the first press, so the first save tone of a
       shift is no longer the one that gets swallowed */
    if(_ac.state === 'suspended') _ac.resume();
    if(kind === 'tap'){
      /* A tock, not a beep. Measured against the save tone rather than judged
         by ear: this renders at peak 0.106 and RMS 0.0215, about three fifths
         of the save tone's loudness in a third of its length. The first
         attempt was 1500Hz at peak 0.055 for 35ms - three times quieter and
         five times shorter than the save tone, with barely twenty
         milliseconds of real signal, and it could not reliably be heard at
         all. The drop from 900 to 380Hz is what gives it body; a flat tone up
         at 1500 is thin and reads as a beep. */
      tone(900, 0, { dur:0.055, peak:0.11, type:'triangle', to:380 });
      return;
    }
    var notes = kind === 'notify' ? [[660, 0], [990, 0.13]]
              : kind === false    ? [[320, 0]]
                                  : [[880, 0]];
    notes.forEach(function(n){ tone(n[0], n[1]); });
  }catch(e){}
  /* a phone that can buzz, buzzes too; an iPad simply will not, and that is
     fine - the sound is the part that works everywhere. Never on a tap: a buzz
     on every press would be intolerable inside a shift. */
  try{
    if(navigator.vibrate && kind !== 'tap') navigator.vibrate(
      kind === false ? [60,40,60] : kind === 'notify' ? [30,60,30] : 25);
  }catch(e){}
}
function tone(hz, at, o2){
  o2 = o2 || {};
  var dur = o2.dur || 0.18, peak = o2.peak || 0.16;
  var t = _ac.currentTime + at;
  var o = _ac.createOscillator(), g = _ac.createGain();
  o.type = o2.type || 'sine';
  o.frequency.setValueAtTime(hz, t);
  /* a tick that drops a little reads as a click rather than a beep */
  if(o2.to) o.frequency.exponentialRampToValueAtTime(o2.to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(_ac.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
/* ---- the tick, on anything that is actually a control ----
   One listener rather than a handler on each button. Most of this app's
   buttons are drawn as strings by the render functions, so anything that had
   to be added per element would be missing from the first button somebody
   added next month. pointerdown rather than click, because the whole point is
   that the press feels answered - waiting for click puts the sound after the
   screen has already changed. */
var TAPPABLE = 'button, a[href], [role="switch"], [role="button"], summary';
document.addEventListener('pointerdown', function(e){
  if(!PREFS.tap) return;
  var el = e.target && e.target.closest ? e.target.closest(TAPPABLE) : null;
  if(!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
  beep('tap');
}, true);

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

/* ---- how tall the header actually is ----
   Three screens size themselves to "the window, less the header", and every
   one of them had 62px written into it. The header is 66px since the account
   menu moved into it, so each of those screens overflowed the window by 4px
   and the page scrolled when it should not have. Measure it instead. */
function hdrMeasure(){
  var h = document.querySelector('header');
  if(!h) return;
  var px = Math.round(h.getBoundingClientRect().height);
  if(px > 0) document.documentElement.style.setProperty('--hdr-h', px + 'px');
}
window.addEventListener('resize', hdrMeasure);
window.addEventListener('orientationchange', hdrMeasure);
if(window.ResizeObserver){
  try{
    var _hdr = document.querySelector('header');
    if(_hdr) new ResizeObserver(hdrMeasure).observe(_hdr);
  }catch(e){}
}
hdrMeasure();

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
    + prefsSwitch('sound', 'Sounds',
        'A short tone when a form goes, and two notes when the bell has '
        + 'something new. Off silences both.')
    + prefsSwitch('tap', 'Tap sounds',
        'A quiet tick when you press something, so the tablet answers you. '
        + 'Separate from the tones above.')
    + (canWake
        ? prefsSwitch('awake', 'Keep the screen awake',
            'While Checkpoint is open. Uses more battery.')
        : '<div class="prow"><div class="ptext"><b>Keep the screen awake</b>'
          + '<span>This browser cannot hold the screen on. Open Checkpoint from '
          + 'the home screen, or set the screen timeout on the device.</span></div></div>')
    + (('Notification' in window)
        ? prefsSwitch('popup', 'Pop-up alerts',
            'When Checkpoint is in another tab, new items come up as a pop-up '
            + 'from the system and fade on their own. Nothing pops up over a '
            + 'screen you are already looking at.')
        : '')
    + prefsSwitch('handocr', 'Read handwriting on photos',
        'A reader trained on handwriting, downloaded once. Off means the '
        + 'print reader only.')
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

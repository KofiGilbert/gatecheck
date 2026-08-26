/* Checkpoint · the admin panel

   What the app does, rather than what is on any one screen. Everything here is
   kept in the settings document the whole team already reads, so a change made
   once is a change everywhere.

   Who may change any of it is decided by the account they signed in with, not
   by a password typed into this page. A password checked in the browser is a
   door, not a lock - anyone who can open the app can read what it checks. The
   rule on /settings/app in firestore.rules is the real boundary, and this
   screen only shows what that rule will allow. */

/* the admin sets how the app behaves; the receiving office may too, so a site
   is never locked out of its own settings */
function adminMay(){
  var r = (window.CLOUD && CLOUD.role) || '';
  return r === 'admin' || (typeof isOffice === 'function' && isOffice());
}

/* The delivery switches. Each answers one question: which document, and by
   which route. Named for the document an officer would recognise, not for a
   part of the system. */
var ADM_DOCS = [
  { k:'form', name:'Seal verification',
    sub:'Filled at the gate when a driver arrives' },
  { k:'yard', name:'Yard check',
    sub:'The trailer inspection log, every two hours' },
  { k:'dar',  name:'Daily activity report',
    sub:'The shift report, at the end of a shift' }
];
var ADM_DEFAULT = {
  form: { email:true, app:true },
  yard: { email:true, app:true },
  dar:  { email:true, app:false }
};

function admSettings(){
  var raw = sget('gc_admin');
  var out = { deliver: JSON.parse(JSON.stringify(ADM_DEFAULT)), queueHours: 12 };
  try{
    var d = raw ? JSON.parse(raw) : {};
    if(d && d.deliver) ADM_DOCS.forEach(function(x){
      if(d.deliver[x.k]) out.deliver[x.k] = {
        email: d.deliver[x.k].email !== false,
        app:   d.deliver[x.k].app   !== false
      };
    });
    if(d && +d.queueHours > 0) out.queueHours = +d.queueHours;
  }catch(e){}
  return out;
}
function admSave(s){
  sset('gc_admin', JSON.stringify(s));
  if(typeof adminCloudSave === 'function') adminCloudSave(s);
}
/* Does this kind of document go out by this route? Anything not set is on:
   the app delivered before there was a panel, and it keeps delivering. */
function admGoes(kind, route){
  var d = admSettings().deliver[kind];
  return d ? d[route] !== false : true;
}

/* ---------- getting in ---------- */
function adminOpen(){ go('admin'); }
function adminGate(){
  var lock = $('adm_lock'), body = $('adm_body');
  var may = adminMay();
  if(lock) lock.hidden = may;
  if(body) body.hidden = !may;
  if(may) adminRender();
}
/* ---------- the panel ---------- */
function adminRender(){
  var host = $('adm_body'); if(!host) return;
  var s = admSettings();
  var office = adminMay();

  host.innerHTML =
    (office ? '' :
      '<div class="warn">These are read only for this account.</div>')
    + '<div class="card">'
    +   '<h2>Where completed work goes</h2>'
    +   ADM_DOCS.map(function(d){
          var v = s.deliver[d.k];
          return '<div class="admrow">'
            + '<div class="admwhat"><b>' + esc(d.name) + '</b><span>' + esc(d.sub) + '</span></div>'
            + admSwitch(d.k, 'email', 'Email', v.email, office)
            + admSwitch(d.k, 'app', 'In the app', v.app, office)
            + '</div>';
        }).join('')
    +   '<div class="hint">A document with both switched off has nowhere to go, '
    +     'so the last one on cannot be turned off.</div>'
    + '</div>'

    + '<div class="card">'
    +   '<h2>Addresses</h2>'
    +   admField('adm_email', 'Receiving office', getOfficeEmail(),
              'Where completed forms go.', office)
    +   admField('adm_manager', 'Manager', (sget('gc_manager')||''),
              'Where the daily activity report goes.', office)
    +   admField('adm_cc', 'Copies to', getCcEmails(),
              'Everyone here gets a copy of every form. Separate with commas.', office)
    +   admField('adm_mailer', 'Auto-send service link', getMailerUrl(),
              'With this filled in, email sends itself. Empty, and the officer’s '
              + 'mail app opens instead.', office)
    + '</div>'

    + '<div class="card">'
    +   '<h2>The gate queue</h2>'
    +   '<label class="f">A driver stays in the queue for</label>'
    +   '<select id="adm_qhours"' + (office ? '' : ' disabled') + '>'
    +     [4,8,12,24].map(function(h){
            return '<option value="' + h + '"' + (s.queueHours === h ? ' selected' : '')
              + '>' + h + ' hours</option>'; }).join('')
    +   '</select>'
    +   '<div class="hint">After this they drop off the list. A shift is eight hours.</div>'
    + '</div>'

    + '<div class="card">'
    +   '<h2>Site</h2>'
    +   admField('adm_site', 'Location', getLocation(),
              'Printed on the gate log and the daily activity report.', office)
    + '</div>'

    + '<button class="btn sec" onclick="go(homeSection())">Done</button>';

  if(office) adminWire();
}
function admSwitch(kind, route, label, on, live){
  return '<label class="admsw' + (on ? ' on' : '') + '">'
    + '<input type="checkbox"' + (on ? ' checked' : '') + (live ? '' : ' disabled')
    +   ' data-kind="' + kind + '" data-route="' + route + '"'
    +   ' onchange="admToggle(this)">'
    + '<span>' + esc(label) + '</span></label>';
}
function admField(id, label, value, hint, live){
  return '<label class="f">' + esc(label) + '</label>'
    + '<input type="text" id="' + id + '" value="' + esc(value) + '"'
    +   (live ? '' : ' disabled') + ' autocomplete="off">'
    + '<div class="hint">' + hint + '</div>';
}
/* A document with every route off is a document that goes nowhere, and the
   officer who filled it in would never know. The last one on stays on. */
function admToggle(el){
  var s = admSettings();
  var kind = el.getAttribute('data-kind'), route = el.getAttribute('data-route');
  var d = s.deliver[kind]; if(!d) return;
  var other = (route === 'email') ? 'app' : 'email';
  if(!el.checked && !d[other]){
    el.checked = true;
    var name = (ADM_DOCS.filter(function(x){ return x.k === kind; })[0] || {}).name || 'that';
    toast(name + ' has to go somewhere');
    return;
  }
  d[route] = el.checked;
  admSave(s);
  adminRender();
  toast('Saved');
}
function adminWire(){
  var pairs = [
    ['adm_email',   'gc_email',   'officeEmail'],
    ['adm_manager', 'gc_manager', 'managerEmail'],
    ['adm_cc',      'gc_cc',      'ccEmails'],
    ['adm_mailer',  'gc_mailer',  'mailerUrl'],
    ['adm_site',    'gc_location','site']
  ];
  pairs.forEach(function(p){
    var el = $(p[0]); if(!el) return;
    el.addEventListener('change', function(){
      var v = el.value.trim();
      sset(p[1], v);
      if(typeof adminCloudField === 'function') adminCloudField(p[2], v);
      if(p[1] === 'gc_location' && typeof menuFill === 'function') menuFill();
      toast('Saved');
    });
  });
  var q = $('adm_qhours');
  if(q) q.addEventListener('change', function(){
    var s = admSettings(); s.queueHours = +q.value || 12; admSave(s); toast('Saved');
  });
}

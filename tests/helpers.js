const FB_STUB = (opts) => {
  window.__fb = Object.assign({ user:null, authError:null, resetError:null, pending:false, authDelay:0, orders:[], role:'officer' }, opts||{});
  const listeners = [];
  const err = (code) => { const e = new Error('stub'); e.code = code; return e; };
  const authObj = {
    onAuthStateChanged(cb){ listeners.push(cb); setTimeout(()=>{ cb(window.__fb.user); window.__fb.settled = true; }, window.__fb.authDelay||0); return ()=>{}; },
    signInWithEmailAndPassword(em){
      if(window.__fb.pending) return new Promise(()=>{});
      if(window.__fb.authError) return Promise.reject(err(window.__fb.authError));
      window.__fb.user = { email: em };
      listeners.forEach(cb=>cb(window.__fb.user));
      return Promise.resolve({ user: window.__fb.user });
    },
    sendPasswordResetEmail(){
      if(window.__fb.resetError) return Promise.reject(err(window.__fb.resetError));
      return Promise.resolve();
    },
    signOut(){ window.__fb.user=null; listeners.forEach(cb=>cb(null)); return Promise.resolve(); },
  };
  const mkChain = (name) => {
    const chain = {
      onSnapshot(cb){
        const rows = name === 'orders' ? (window.__fb.orders || [])
                   : name === 'forms'  ? (window.__fb.forms  || []) : [];
        setTimeout(()=>cb({ docs: rows.map(r => ({ id: r._id || r.order || '', data: () => r })) }),0);
        return ()=>{};
      },
      orderBy(){ return chain; }, limit(){ return chain; },
      doc(id){ return {
        id: id,
        onSnapshot(cb){
          const isOfficers = name === 'officers';
          setTimeout(()=>cb({
            exists: isOfficers,
            data: () => isOfficers ? { role: window.__fb.role, name: window.__fb.officerName || '' } : {},
          }),0);
          return ()=>{};
        },
        set(){ return Promise.resolve(); },
        update(data){ (window.__fb.updated = window.__fb.updated || []).push({ id, data });
          return Promise.resolve(); },
        delete(){ return Promise.resolve(); },
      }; },
    };
    return chain;
  };
  window.firebase = {
    initializeApp(){ return {}; },
    firestore(){ return {
      enablePersistence(){ return Promise.resolve(); },
      collection(n){ return mkChain(n); },
      _name: 'db',
      batch(){
        /* record what the app publishes so tests can assert on it */
        return {
          set(ref, data){ (window.__fb.written = window.__fb.written || []).push(data); },
          delete(ref){ (window.__fb.deleted = window.__fb.deleted || []).push(ref && ref.id); },
          commit(){ return Promise.resolve(); },
        };
      },
    }; },
    auth(){ return authObj; },
  };
};

async function gotoApp(page, opts) {
  await page.route('**/firebasejs/**', r => r.fulfill({ contentType:'application/javascript', body:'' }));
  await page.addInitScript(FB_STUB, opts || {});
  await page.goto('/index.html');
  await page.waitForFunction(() => typeof window.doLogin === 'function' && window.__fb && window.__fb.settled);
  // let the overlay entrance animation land so nothing is measured mid-flight
  await page.evaluate(() => Promise.all(
    document.getAnimations().map(a => a.finished.catch(()=>{}))
  ));
}

function lum({r,g,b}){
  const f = c => { c/=255; return c<=0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); };
  return 0.2126*f(r) + 0.7152*f(g) + 0.0722*f(b);
}
function ratio(fg, bg){
  const a = lum(fg), b = lum(bg);
  return (Math.max(a,b)+0.05) / (Math.min(a,b)+0.05);
}
function over(fg, bg){
  if(fg.a >= 1) return fg;
  return { r: fg.r*fg.a + bg.r*(1-fg.a), g: fg.g*fg.a + bg.g*(1-fg.a), b: fg.b*fg.a + bg.b*(1-fg.a), a:1 };
}
function parseRGB(s){
  const m = String(s).match(/rgba?\(([^)]+)\)/); if(!m) return null;
  const p = m[1].split(/[,\s\/]+/).filter(Boolean).map(v=>parseFloat(v));
  return { r:p[0], g:p[1], b:p[2], a: p.length>3 ? p[3] : 1 };
}
async function effectiveBg(page, selector){
  const stack = await page.$eval(selector, el => {
    let n = el, out = [];
    while(n && n.nodeType === 1){
      const m = getComputedStyle(n).backgroundColor.match(/rgba?\(([^)]+)\)/);
      if(m){
        const p = m[1].split(/[,\s\/]+/).filter(Boolean).map(v=>parseFloat(v));
        const a = p.length>3 ? p[3] : 1;
        if(a > 0){ out.push({r:p[0],g:p[1],b:p[2],a}); if(a >= 1) break; }
      }
      n = n.parentElement;
    }
    return out;
  });
  let base = { r:255, g:255, b:255, a:1 };
  for(let i = stack.length-1; i >= 0; i--) base = over(stack[i], base);
  return base;
}
async function styleOf(page, selector, props){
  return page.$eval(selector, (el, props) => {
    const cs = getComputedStyle(el); const out = {};
    for(const p of props) out[p] = cs.getPropertyValue(p);
    return out;
  }, props);
}
async function pseudo(page, selector, which, props){
  return page.$eval(selector, (el, a) => {
    const cs = getComputedStyle(el, a.which); const out = {};
    for(const p of a.props) out[p] = cs.getPropertyValue(p);
    return out;
  }, { which, props });
}
module.exports = { FB_STUB, gotoApp, parseRGB, lum, ratio, over, effectiveBg, styleOf, pseudo };

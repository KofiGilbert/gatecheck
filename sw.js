/* The app shell, kept on the device.
   A yard is a bad place for signal. The shell is served from the cache so the
   app opens whether or not there is a connection; the data behind it comes from
   Firestore, which keeps its own offline copy. Nothing here caches a request to
   Firebase: stale gate log rows would be worse than none. */
var SHELL = 'checkpoint-shell-v5';
var FILES = [
  './', './index.html',
  './js/app.js', './js/cloud.js', './js/yard.js', './js/stats.js', './js/dar.js',
  './js/import.js', './js/prefs.js', './js/ingest.js', './js/queue.js', './vendor/fflate.js',
  './assets/mb-logo.png', './assets/icon.svg',
  './manifest.webmanifest'
];

self.addEventListener('install', function(e){
  e.waitUntil(caches.open(SHELL).then(function(c){
    /* one missing file must not fail the whole install */
    return Promise.all(FILES.map(function(f){
      return c.add(f).catch(function(){});
    }));
  }).then(function(){ return self.skipWaiting(); }));
});

self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k !== SHELL; })
      .map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});

/* the network, with the cache waiting behind it */
function swFresh(req){
  var fromCache = caches.match(req);
  var timer;
  var live = new Promise(function(done, fail){
    timer = setTimeout(function(){ fail(new Error('slow')); }, 3000);
    fetch(req).then(done, fail);
  }).then(function(res){
    clearTimeout(timer);
    if(res && res.status === 200){
      var copy = res.clone();
      caches.open(SHELL).then(function(c){ c.put(req, copy); });
    }
    return res;
  });
  return live.catch(function(){
    return fromCache.then(function(hit){ return hit || live; });
  });
}
self.addEventListener('fetch', function(e){
  var url = new URL(e.request.url);
  if(e.request.method !== 'GET') return;
  /* never come between the app and its data */
  if(url.origin !== self.location.origin) return;
  if(/googleapis|gstatic|firebase/.test(url.href)) return;
  /* the handwriting model is tens of megabytes and the browser caches it
     already; putting it in the app shell would evict everything else */
  if(/jsdelivr|huggingface|hf\.co|paddle/i.test(url.href)) return;

  /* The page itself comes from the network when there is one. Serving a
     cached index.html first meant every change landed one refresh late, and
     an office looking at yesterday's build is worse than a second's wait. */
  var isPage = e.request.mode === 'navigate'
            || /\/(index\.html)?$/.test(url.pathname);
  if(isPage){
    e.respondWith(fetch(e.request).then(function(res){
      if(res && res.status === 200){
        var copy = res.clone();
        caches.open(SHELL).then(function(c){ c.put(e.request, copy); });
      }
      return res;
    }).catch(function(){
      return caches.match(e.request).then(function(hit){
        return hit || caches.match('./index.html');
      });
    }));
    return;
  }

  /* The app's own code, the same way as the page: from the network when there
     is one, from the cache when there is not.

     It used to answer from the cache at once and refresh it "for next time".
     That meant the first refresh after a deploy served the new index.html with
     the previous version's JavaScript - a new page running old code - and only
     the second refresh put them right. It is why every deploy came with an
     instruction to clear Safari's website data, and on 25 August 2026 it cost
     a completed yard check: the tablet was still running a version that
     refused it, the officer saw a toast and thought it had gone, and the
     office waited for a check that was never sent.

     A yard has bad signal, so the cache still answers when the network cannot,
     and a slow network is given three seconds before falling back. */
  e.respondWith(swFresh(e.request));
});

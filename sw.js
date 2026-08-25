/* The app shell, kept on the device.
   A yard is a bad place for signal. The shell is served from the cache so the
   app opens whether or not there is a connection; the data behind it comes from
   Firestore, which keeps its own offline copy. Nothing here caches a request to
   Firebase: stale gate log rows would be worse than none. */
var SHELL = 'checkpoint-shell-v4';
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

self.addEventListener('fetch', function(e){
  var url = new URL(e.request.url);
  if(e.request.method !== 'GET') return;
  /* never come between the app and its data */
  if(url.origin !== self.location.origin) return;
  if(/googleapis|gstatic|firebase/.test(url.href)) return;
  /* the handwriting model is tens of megabytes and the browser caches it
     already; putting it in the app shell would evict everything else */
  if(/jsdelivr|huggingface|hf\.co/.test(url.href)) return;

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

  /* everything else: use the cache at once, and quietly refresh it for next time */
  e.respondWith(caches.match(e.request).then(function(hit){
    var live = fetch(e.request).then(function(res){
      if(res && res.status === 200){
        var copy = res.clone();
        caches.open(SHELL).then(function(c){ c.put(e.request, copy); });
      }
      return res;
    }).catch(function(){ return hit; });
    return hit || live;
  }));
});

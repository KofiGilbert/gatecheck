/* ===================== getting the schedule in =====================

   The schedule reaches the receiving office in whatever shape the sender
   happened to have it in. Over a few weeks that has meant:

     .xlsx     the normal week, straight out of the planning system
     .pdf      a vendor sent it, or somebody printed to PDF
     .docx     somebody pasted the table into Word and mailed that
     a photo   a manager is standing at the printer with their phone
     a paste   the fastest of all: select in Excel, copy, paste here

   None of those is the office's fault, and none of them should mean typing
   forty orders in by hand. So there is one place to put a file, it takes all
   five, and every one of them lands in the same draft grid to be checked
   before anything reaches the yard.

   Nothing here talks to a network. The PDF reader is Mozilla's pdf.js, kept
   in /vendor and loaded the first time a PDF actually arrives; the photo
   reader is the Tesseract engine already in /vendor. A gatehouse with no
   signal can still load a schedule.
*/

/* ---------- where the loader is, and what it is loading ----------
   One loader, moved to whichever screen is asking for a file. The schedule
   wants orders; a yard check wants the list of trailers in the block. The
   readers are the same; only the far end differs. */
var DZ_MODE = 'schedule';
var DZ_TEXT = {
  schedule: {
    title: 'Drop a file here, or press +',
    hint:  'Spreadsheet, PDF, Word or a photo of the printed sheet. You can also '
         + 'copy the rows in Excel and paste them straight onto this page.',
    touch: 'Spreadsheet, PDF, Word, or photograph the printed sheet with this '
         + 'device. You can also paste rows copied out of Excel.',
    paste: 'Paste rows from Excel',
    ph:    'Select the rows in Excel, copy, and paste them here'
  },
  block: {
    title: 'Load the trailer list',
    hint:  'A photo of the block sheet, a spreadsheet, or paste the trailer '
         + 'numbers in. They land in the box below to be checked before release.',
    touch: 'Photograph the block sheet with this device, load a spreadsheet, or '
         + 'paste the numbers in. They land below to be checked before release.',
    paste: 'Paste trailer numbers',
    ph:    'One per line, trailer number then product:\nLR7524, FRIES\nR25106, FRIES'
  },
  yard: {
    title: 'Load the trailer list',
    hint:  'A photo of the block sheet, a spreadsheet, or paste the trailer '
         + 'numbers straight in. One trailer per line.',
    touch: 'Photograph the block sheet with this device, load a spreadsheet, '
         + 'or paste the trailer numbers in. One trailer per line.',
    paste: 'Paste trailer numbers',
    ph:    'One trailer per line, for example:\nLR7524 FRIES\nLR7540 BUNS'
  }
};
function dzAttach(hostId, mode){
  var wrap = document.getElementById('dzwrap');
  var host = document.getElementById(hostId);
  if(!wrap || !host) return;
  DZ_MODE = DZ_TEXT[mode] ? mode : 'schedule';
  if(wrap.parentNode !== host) host.appendChild(wrap);
  wrap.hidden = false;
  ingPasteClose();
  ingMenuClose();
  ingQuiet();
  var t = DZ_TEXT[DZ_MODE];
  var set = function(id, v){ var e = document.getElementById(id); if(e) e.textContent = v; };
  set('dztitle', t.title);
  set('dzhint', ingHasCamera() ? t.touch : t.hint);
  set('pbttl', t.paste);
  var pasteBtn = document.getElementById('dzpaste');
  if(pasteBtn) pasteBtn.innerHTML = '\u270f\ufe0f ' + esc(t.paste);
  var ta = document.getElementById('paste');
  if(ta) ta.setAttribute('placeholder', t.ph);
  /* Every way in, on every screen. A trailer list turns up as a PDF or a
     Word file as readily as a schedule does, and deciding otherwise on the
     office's behalf just sent them away to convert it first. */
  ['dzpdf','dzdoc'].forEach(function(id){
    var b = document.getElementById(id); if(b) b.hidden = false;
  });
}
function dzDetach(){
  var wrap = document.getElementById('dzwrap');
  if(!wrap) return;
  wrap.hidden = true;
  ingPasteClose();
  ingMenuClose();
}

/* ---------- the + menu ---------- */
var ING_ACCEPT = {
  sheet: '.xlsx,.xlsm,.csv,.tsv,.txt,.json',
  pdf:   '.pdf,application/pdf',
  doc:   '.docx',
  photo: 'image/*',
  any:   '.json,.csv,.tsv,.txt,.xlsx,.xlsm,.pdf,.docx,image/*'
};
function ingMenuEl(){ return document.getElementById('dzmenu'); }
function ingMenuOpen(){ var m = ingMenuEl(); return !!m && !m.hidden; }
function ingMenuClose(){
  var m = ingMenuEl(); if(!m) return;
  m.hidden = true;
  var b = document.getElementById('dzplus');
  if(b) b.setAttribute('aria-expanded','false');
}
function ingMenu(e){
  if(e){ e.preventDefault(); e.stopPropagation(); }
  var m = ingMenuEl(); if(!m) return;
  var opening = m.hidden;
  m.hidden = !opening;
  var b = document.getElementById('dzplus');
  if(b) b.setAttribute('aria-expanded', String(opening));
  if(opening){
    var first = m.querySelector('button');
    if(first) first.focus();
  }
}
function ingPick(kind){
  ingMenuClose();
  var f = document.getElementById('file'); if(!f) return;
  f.setAttribute('accept', ING_ACCEPT[kind] || ING_ACCEPT.any);
  f.click();
}
/* There is no separate camera entry. On a phone or an iPad, tapping a photo
   input opens the operating system's own sheet, and Take Photo is already in
   it beside the library. A second button for the same thing is one more line
   of menu that does nothing new. */
function ingHasCamera(){
  try{
    if((navigator.maxTouchPoints || 0) > 0) return true;
    if('ontouchstart' in window) return true;
    return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  }catch(e){ return false; }
}
function ingPasteClose(){
  var box = document.getElementById('pastebox');
  if(box) box.style.display = 'none';
  var ta = document.getElementById('paste');
  if(ta) ta.value = '';
}
function ingPasteBox(){
  ingMenuClose();
  var box = document.getElementById('pastebox');
  if(box) box.style.display = 'block';
  var ta = document.getElementById('paste');
  if(ta) ta.focus();
}
document.addEventListener('click', function(e){
  if(!ingMenuOpen()) return;
  var dz = document.getElementById('dz');
  if(dz && dz.contains(e.target)) return;
  ingMenuClose();
});
document.addEventListener('keydown', function(e){
  if(e.key === 'Escape' && ingMenuOpen()){
    ingMenuClose();
    var b = document.getElementById('dzplus'); if(b) b.focus();
  }
});

/* ---------- saying what is happening ---------- */
function ingSay(name, msg, pct){
  var box = document.getElementById('dzprog'); if(!box) return;
  box.hidden = false;
  box.innerHTML =
      '<div class="dzrow"><b>' + esc(name) + '</b><span>' + esc(msg) + '</span></div>'
    + '<div class="dzbar' + (pct == null ? ' wait' : '') + '"><i style="width:'
    + (pct == null ? 0 : Math.max(0, Math.min(100, pct))) + '%"></i></div>';
  box.setAttribute('role','status');
  box.setAttribute('aria-live','polite');
}
function ingQuiet(){
  var box = document.getElementById('dzprog');
  if(box){ box.hidden = true; box.innerHTML = ''; }
}

/* ---------- which reader does this file need ---------- */
function ingKind(f){
  var n = String(f && f.name || '').toLowerCase();
  var t = String(f && f.type || '').toLowerCase();
  if(/\.(xlsx|xlsm)$/.test(n)) return 'xlsx';
  if(/\.pdf$/.test(n) || t === 'application/pdf') return 'pdf';
  if(/\.docx$/.test(n)) return 'docx';
  if(/\.(json|csv|tsv|txt)$/.test(n)) return 'text';
  if(/^image\//.test(t) || /\.(jpe?g|png|gif|bmp|webp|heic|heif)$/.test(n)) return 'photo';
  if(/\.(doc|xls|xlt|rtf)$/.test(n)) return 'old';
  return '';
}
function ingSize(f){
  var b = (f && f.size) || 0;
  return b > 1048576 ? (b/1048576).toFixed(1)+' MB' : Math.max(1, Math.round(b/1024))+' KB';
}
function ingBuffer(file){
  return new Promise(function(res, rej){
    var r = new FileReader();
    r.onload  = function(){ res(r.result); };
    r.onerror = function(){ rej(new Error('That file could not be opened')); };
    r.readAsArrayBuffer(file);
  });
}
function ingText(file){
  return new Promise(function(res, rej){
    var r = new FileReader();
    r.onload  = function(){ res(String(r.result || '')); };
    r.onerror = function(){ rej(new Error('That file could not be opened')); };
    r.readAsText(file);
  });
}

/* ---------- a grid of cells becomes the draft ----------
   Every reader below ends up with rows of cells. The header row is the one
   naming the order number, and everything above it is a letterhead. Handing
   the rest to the existing importer means a PDF and a spreadsheet arrive in
   the draft grid by exactly the same road, and get the same column aliases. */
function ingHeaderRow(grid){
  for(var i = 0; i < grid.length; i++){
    var r = grid[i] || [];
    if(r.length < 3) continue;
    var joined = r.join(' ').toLowerCase();
    if(/order\s*(number|no\.?|#)?/.test(joined) && /(vendor|carrier|cases|pallet|zone)/.test(joined))
      return i;
  }
  return -1;
}
function ingGridToTsv(grid){
  var hi = ingHeaderRow(grid);
  if(hi < 0) return '';
  return grid.slice(hi).map(function(r){ return r.join('\t'); }).join('\n');
}
/* Two ways in, in order of how much we can trust them. A real header row means
   the columns are known. Without one we fall back to the reader written for
   photographs, which finds orders by their shape (80xxxxx, LIVE/DROP, a zone)
   and puts them in front of a person to confirm. */
function ingTsvHasOrders(tsv){
  try{
    return parseCSV(tsv).some(function(o){
      var n = (typeof normalizeRow === 'function') ? normalizeRow(o) : o;
      return /^80\d{5,6}$/.test(String(n && n.order || '').replace(/\D/g, ''));
    });
  }catch(e){ return false; }
}
function ingLand(grid, what){
  var tsv = ingGridToTsv(grid);
  if(tsv && ingTsvHasOrders(tsv)){ ingest(tsv); return true; }
  var text = grid.map(function(r){ return r.join('  '); }).join('\n');
  var parsed = (typeof parseOcr === 'function') ? parseOcr(text) : {rows:[]};
  if(parsed && parsed.rows && parsed.rows.length){ openReview(parsed); return true; }
  toast('No order rows found in that ' + what + '. Check it is the schedule, or try the .xlsx file.');
  return false;
}

/* ---------- Word ----------
   A .docx is a zip of XML, the same as a .xlsx, so the unzipper already here
   opens it. What we want is the table; if there is no table, each paragraph
   is a line and Word's own tabs are the columns. */
function ingDocxGrid(buf){
  var files = fflate.unzipSync(new Uint8Array(buf));
  var body = files['word/document.xml'];
  if(!body) throw new Error('There is no readable document inside that .docx');
  var doc = new DOMParser().parseFromString(new TextDecoder().decode(body), 'application/xml');
  var grid = [], t, r, c;
  var tbls = doc.getElementsByTagName('w:tbl');
  for(t = 0; t < tbls.length; t++){
    var trs = tbls[t].getElementsByTagName('w:tr');
    for(r = 0; r < trs.length; r++){
      var tcs = trs[r].getElementsByTagName('w:tc'), row = [];
      for(c = 0; c < tcs.length; c++)
        row.push(String(tcs[c].textContent || '').replace(/\s+/g, ' ').trim());
      if(row.some(function(v){ return v !== ''; })) grid.push(row);
    }
  }
  if(grid.length) return grid;
  var ps = doc.getElementsByTagName('w:p');
  for(var i = 0; i < ps.length; i++){
    var line = String(ps[i].textContent || '').replace(/ /g, ' ').trim();
    if(line) grid.push(line.split(/\t| {2,}/).map(function(s){ return s.trim(); }));
  }
  return grid;
}

/* ---------- PDF ----------
   pdf.js is 1.5MB and most weeks nobody sends a PDF, so it is fetched the
   first time one actually arrives and kept for the rest of the session. */
var _pdfLib = null;
function ingPdfLib(){
  if(window.pdfjsLib){
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    return Promise.resolve(window.pdfjsLib);
  }
  if(_pdfLib) return _pdfLib;
  _pdfLib = new Promise(function(res, rej){
    var s = document.createElement('script');
    s.src = 'vendor/pdf.min.js';
    s.onload = function(){
      if(!window.pdfjsLib){ _pdfLib = null; rej(new Error('The PDF reader did not load')); return; }
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
      res(window.pdfjsLib);
    };
    s.onerror = function(){ _pdfLib = null; rej(new Error('The PDF reader did not load')); };
    document.head.appendChild(s);
  });
  return _pdfLib;
}
/* A PDF has no rows, only pieces of text at coordinates. Pieces sharing a
   baseline are one row; left to right across that baseline is the order of
   the columns. Three points of tolerance, because a printed row is rarely
   perfectly level. */
function ingPdfRows(tc){
  var bands = {};
  (tc.items || []).forEach(function(it){
    var s = String(it.str || '');
    if(!s.trim()) return;
    var y = Math.round(it.transform[5] / 3);
    (bands[y] = bands[y] || []).push({ x: it.transform[4], s: s.trim() });
  });
  return Object.keys(bands).sort(function(a, b){ return b - a; }).map(function(k){
    return bands[k].sort(function(a, b){ return a.x - b.x; })
                   .map(function(i){ return i.s; })
                   .filter(function(s){ return s !== ''; });
  });
}
function ingPdfGrid(buf, name){
  return ingPdfLib().then(function(lib){
    return lib.getDocument({ data: new Uint8Array(buf) }).promise;
  }).then(function(pdf){
    var grid = [], n = pdf.numPages, scanned = 0;
    function page(i){
      if(i > n) return Promise.resolve();
      ingSay(name, 'Reading page ' + i + ' of ' + n, Math.round(((i - 1) / n) * 100));
      return pdf.getPage(i).then(function(pg){
        return pg.getTextContent().then(function(tc){
          var rows = ingPdfRows(tc);
          var letters = rows.join('').replace(/[^A-Za-z0-9]/g, '').length;
          /* almost no text on the page means it is a scan of paper, not a
             printout, so it goes to the photo reader instead */
          if(letters < 40){ scanned++; return ingPdfScan(pg, name, i, n, grid); }
          grid.push.apply(grid, rows);
        });
      }).then(function(){ return page(i + 1); });
    }
    return page(1).then(function(){ return grid; });
  });
}
function ingPdfScan(pg, name, i, n, grid){
  if(typeof getWorker !== 'function' || typeof Tesseract === 'undefined') return Promise.resolve();
  ingSay(name, 'Page ' + i + ' of ' + n + ' is a scan, reading it as a photo', null);
  var vp = pg.getViewport({ scale: 2 });
  var cv = document.createElement('canvas');
  cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
  return pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise
    .then(function(){ return getWorker(); })
    .then(function(w){ return w.recognize(typeof preprocess === 'function' ? preprocess(cv) : cv); })
    .then(function(res){
      String(res.data.text || '').split(/\r?\n/).forEach(function(line){
        if(line.trim()) grid.push(line.trim().split(/\s{2,}|\t/));
      });
    })
    .catch(function(){});
}

/* ---------- a trailer list, however it arrives ----------
   The block sheet is a short list: a trailer number and what is in it. The
   photo reader already knows how to pull that out of a page of text, so the
   pasted and spreadsheet routes hand it the same thing. */
function ingYardLand(rows, what){
  if(!rows || !rows.length){
    toast('No trailer numbers found in that ' + what + '.');
    return false;
  }
  if(typeof YC === 'undefined' || !YC) ycLoadDraft();
  if(YC.rows.length && !confirm('Replace the current ' + YC.rows.length
      + ' trailer(s) with the ' + rows.length + ' in that ' + what + '?')) return false;
  YC.rows = rows;
  ycSaveDraft();
  if(typeof renderYcGrid === 'function') renderYcGrid();
  if(typeof renderYard === 'function') renderYard();
  toast('Loaded ' + rows.length + ' trailers. Check the list, then work through them.');
  return true;
}
function ingYardText(text, what){
  return ingYardLand(ycParseTrailers(String(text || '')), what || 'file');
}
/* The office is filling the list it is about to release, not doing a check.
   The rows land in the box so they can be read and corrected first: nothing
   goes to the yard because a photo said so. */
function ingBlockLand(rows, what){
  var box = document.getElementById('bk_list');
  if(!box) return false;
  if(!rows || !rows.length){
    toast('No trailer numbers found in that ' + (what || 'file') + '.');
    return false;
  }
  var text = rows.map(function(r){
    return String(r.trailer || '') + (r.product ? ', ' + r.product : '');
  }).join('\n');
  var had = String(box.value || '').trim();
  if(had && !confirm('Replace the ' + had.split(/\n/).length
      + ' line(s) already in the box with the ' + rows.length + ' just loaded?')) return false;
  box.value = text;
  box.dispatchEvent(new Event('input', { bubbles: true }));
  toast('Loaded ' + rows.length + ' trailers. Check them, then release.');
  return true;
}
function ingBlockText(text, what){
  return ingBlockLand(ycParseTrailers(String(text || '')), what || 'file');
}
function ingYardXlsx(buf){
  var files = fflate.unzipSync(new Uint8Array(buf));
  var dec = new TextDecoder();
  var shared = [], ss = files['xl/sharedStrings.xml'];
  if(ss){
    var doc = new DOMParser().parseFromString(dec.decode(ss), 'application/xml');
    var sis = doc.getElementsByTagName('si');
    for(var i=0;i<sis.length;i++) shared.push(sis[i].textContent);
  }
  var lines = [];
  Object.keys(files).filter(function(k){ return /^xl\/worksheets\/sheet\d+\.xml$/.test(k); })
    .sort().forEach(function(sn){
      var d2 = new DOMParser().parseFromString(dec.decode(files[sn]), 'application/xml');
      var rEls = d2.getElementsByTagName('row');
      for(var r=0;r<rEls.length;r++){
        var cells = [], cEls = rEls[r].getElementsByTagName('c');
        for(var c=0;c<cEls.length;c++){
          var el = cEls[c], t = el.getAttribute('t');
          var v = el.getElementsByTagName('v')[0];
          var txt = v ? v.textContent : '';
          if(t === 's') txt = shared[+txt] || '';
          else if(t === 'inlineStr'){
            var is = el.getElementsByTagName('is')[0];
            txt = is ? is.textContent : '';
          }
          if(String(txt).trim()) cells.push(String(txt).trim());
        }
        if(cells.length) lines.push(cells.join(' '));
      }
    });
  return (DZ_MODE === 'block')
    ? ingBlockText(lines.join('\n'), 'spreadsheet')
    : ingYardText(lines.join('\n'), 'spreadsheet');
}

/* rows of cells, landed wherever this loader is standing */
function ingGridLand(grid, what){
  if(DZ_MODE === 'schedule') return ingLand(grid, what);
  var text = (grid || []).map(function(r){ return r.join(' '); }).join('\n');
  return (DZ_MODE === 'block') ? ingBlockText(text, what) : ingYardText(text, what);
}

/* ---------- the one door ---------- */
function ingestFile(file){
  var name = String(file && file.name || 'file');
  /* many schedules carry their day only here */
  ING_SOURCE = name;
  var kind = ingKind(file);
  if(kind === 'old'){
    ingQuiet();
    toast('This is the old Word or Excel format. Open it, choose Save As, and pick .docx or .xlsx.');
    return Promise.resolve();
  }
  if(!kind){
    ingQuiet();
    toast('Checkpoint cannot read a ' + (name.split('.').pop() || 'file of that type')
        + '. Send it as a spreadsheet, a PDF, a Word file or a photo.');
    return Promise.resolve();
  }
  ingSay(name, ingSize(file), null);

  if(kind === 'xlsx')
    return ingBuffer(file).then(function(b){
      if(DZ_MODE !== 'schedule') return ingYardXlsx(b);
      importXlsx(b);
    });

  if(kind === 'text')
    return ingText(file).then(function(t){
      if(DZ_MODE !== 'schedule') return ingYardText(t, file.name);
      ingest(t);
    });

  if(kind === 'docx')
    return ingBuffer(file).then(function(b){ ingGridLand(ingDocxGrid(b), 'Word document'); });

  if(kind === 'pdf')
    return ingBuffer(file).then(function(b){ return ingPdfGrid(b, name); }).then(function(g){
      ingSay(name, 'Sorting the rows', 100);
      ingGridLand(g, 'PDF');
    });

  /* a photograph: the reader that was already here, now reachable */
  if(DZ_MODE === 'block' && typeof ycPhotoTrailers === 'function')
    return ycPhotoTrailers(file).then(function(rows){ ingBlockLand(rows, 'photo'); });
  if(DZ_MODE === 'yard' && typeof ycImportPhoto === 'function')
    return Promise.resolve(ycImportPhoto(file));
  return Promise.resolve(importPhoto(file));
}
function ingestFiles(list){
  var files = Array.prototype.slice.call(list || []);
  if(!files.length) return Promise.resolve();
  /* one at a time: the progress line has to mean something, and two photo
     reads at once fight over the one OCR engine */
  return files.reduce(function(chain, f){
    return chain.then(function(){
      return ingestFile(f).catch(function(e){
        toast('Could not read ' + (f.name || 'that file') + ': ' + (e && e.message || e));
      });
    });
  }, Promise.resolve()).then(function(){ ingQuiet(); });
}

/* ---------- dropping and pasting ---------- */
/* the loader is on screen, so a drop belongs to it */
function ingOnSched(){
  var wrap = document.getElementById('dzwrap');
  if(!wrap || wrap.hidden) return false;
  var sec = wrap.closest('section');
  return !!sec && sec.classList.contains('on');
}
/* A file dropped anywhere else in the window would otherwise replace the app
   with the file itself, which looks exactly like a crash. */
['dragover','drop'].forEach(function(ev){
  window.addEventListener(ev, function(e){ e.preventDefault(); }, false);
});
(function(){
  var depth = 0;
  function zone(){ return document.getElementById('dz'); }
  function mark(on){ var z = zone(); if(z) z.classList.toggle('over', on); }
  document.addEventListener('dragenter', function(e){
    if(!ingOnSched() || !e.dataTransfer) return;
    depth++; mark(true);
  });
  document.addEventListener('dragleave', function(){
    if(depth > 0) depth--;
    if(!depth) mark(false);
  });
  document.addEventListener('drop', function(e){
    depth = 0; mark(false);
    if(!ingOnSched() || !e.dataTransfer) return;
    var f = e.dataTransfer.files;
    if(f && f.length) ingestFiles(f);
  });
})();
document.addEventListener('paste', function(e){
  if(!ingOnSched() || !e.clipboardData) return;
  var t = e.target, tag = t && t.tagName;
  /* the paste box and any field the office is typing in keep their own paste */
  if(tag === 'TEXTAREA' || tag === 'INPUT' || (t && t.isContentEditable)) return;
  var files = e.clipboardData.files;
  if(files && files.length){ e.preventDefault(); ingestFiles(files); return; }
  var text = e.clipboardData.getData('text/plain') || '';
  if(text.indexOf('\t') < 0 && text.split(/\r?\n/).length < 3) return;
  e.preventDefault();
  if(DZ_MODE === 'block') ingBlockText(text, 'paste');
  else if(DZ_MODE === 'yard') ingYardText(text, 'paste');
  else ingest(text);
});

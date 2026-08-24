/* ===========================================================
   Biblio — logica dell'applicazione
   - Scansione codice a barre (BarcodeDetector nativo o ZXing)
   - Recupero dati libro (Google Books + Open Library)
   - Gestione scaffali (memorizzati) e biblioteca (localStorage)
   =========================================================== */

'use strict';

/* ----------------------- Stato & storage ----------------------- */
const STORAGE_KEY = 'biblio.data.v1';

const store = {
  books: [],    // { id, isbn, title, authors, publisher, year, cover, pages, categories, shelf, addedAt }
  shelves: [],  // elenco scaffali già usati (in ordine di utilizzo recente)
};

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      store.books = Array.isArray(data.books) ? data.books : [];
      store.shelves = Array.isArray(data.shelves) ? data.shelves : [];
    }
  } catch (e) {
    console.warn('Impossibile leggere i dati salvati:', e);
  }
  // Ricava eventuali scaffali mancanti dai libri esistenti
  for (const b of store.books) {
    if (b.shelf) rememberShelf(b.shelf, false);
  }
}

function saveStore() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (e) {
    toast('Errore nel salvataggio dei dati', 'error');
    console.error(e);
  }
}

/** Aggiunge uno scaffale all'elenco memorizzato (se nuovo) e lo porta in cima. */
function rememberShelf(name, persist = true) {
  const clean = (name || '').trim();
  if (!clean) return;
  const idx = store.shelves.findIndex(s => s.toLowerCase() === clean.toLowerCase());
  if (idx !== -1) store.shelves.splice(idx, 1);
  store.shelves.unshift(clean);
  if (persist) saveStore();
}

/* ----------------------- Utilità ----------------------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Normalizza un ISBN: toglie trattini/spazi, valida EAN-13/ISBN-10. */
function normalizeIsbn(raw) {
  if (!raw) return '';
  const s = String(raw).replace(/[^0-9Xx]/g, '').toUpperCase();
  if (s.length === 13 && /^\d{13}$/.test(s)) return s;
  if (s.length === 10 && /^\d{9}[\dX]$/.test(s)) return s;
  return s; // ritorna comunque le cifre trovate (validazione a valle)
}

function isValidIsbn(isbn) {
  return isbn.length === 13 || isbn.length === 10;
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ----------------------- Toast ----------------------- */
let toastTimer = null;
function toast(msg, type = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast ' + type; }, 2600);
}

/* Feedback: beep + vibrazione al rilevamento */
let audioCtx = null;
function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.value = 880;
    g.gain.value = 0.06;
    o.connect(g); g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.12);
  } catch (e) { /* audio non disponibile */ }
  if (navigator.vibrate) navigator.vibrate(120);
}

/* ===========================================================
   RICERCA DATI DEL LIBRO
   =========================================================== */

async function fetchBookData(isbn) {
  // 1) Google Books (senza chiave, CORS ok)
  const google = await fetchFromGoogle(isbn).catch(() => null);
  // 2) Open Library come completamento/fallback
  const openlib = await fetchFromOpenLibrary(isbn).catch(() => null);

  if (!google && !openlib) return null;

  // Unisce i risultati, dando priorità a Google e completando con Open Library
  const g = google || {};
  const o = openlib || {};
  return {
    isbn,
    title: g.title || o.title || '',
    authors: g.authors || o.authors || '',
    publisher: g.publisher || o.publisher || '',
    year: g.year || o.year || '',
    cover: g.cover || o.cover || '',
    pages: g.pages || o.pages || '',
    categories: g.categories || o.categories || '',
  };
}

async function fetchFromGoogle(isbn) {
  const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('google ' + res.status);
  const data = await res.json();
  if (!data.items || !data.items.length) return null;
  const v = data.items[0].volumeInfo || {};
  let cover = '';
  if (v.imageLinks) {
    cover = (v.imageLinks.thumbnail || v.imageLinks.smallThumbnail || '').replace('http://', 'https://');
  }
  return {
    title: v.title ? (v.subtitle ? `${v.title}. ${v.subtitle}` : v.title) : '',
    authors: (v.authors || []).join(', '),
    publisher: v.publisher || '',
    year: (v.publishedDate || '').slice(0, 4),
    cover,
    pages: v.pageCount || '',
    categories: (v.categories || []).join(', '),
  };
}

async function fetchFromOpenLibrary(isbn) {
  const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(isbn)}&format=json&jscmd=data`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('openlib ' + res.status);
  const data = await res.json();
  const key = `ISBN:${isbn}`;
  const b = data[key];
  if (!b) return null;
  return {
    title: b.title || '',
    authors: (b.authors || []).map(a => a.name).join(', '),
    publisher: (b.publishers || []).map(p => p.name).join(', '),
    year: (b.publish_date || '').match(/\d{4}/) ? b.publish_date.match(/\d{4}/)[0] : '',
    cover: b.cover ? (b.cover.medium || b.cover.large || b.cover.small || '') : '',
    pages: b.number_of_pages || '',
    categories: (b.subjects || []).slice(0, 3).map(s => s.name).join(', '),
  };
}

/* ===========================================================
   SCANNER
   =========================================================== */

const scanner = {
  active: false,
  stream: null,
  detector: null,      // BarcodeDetector nativo
  zxingControls: null, // controlli ZXing
  zxingReader: null,
  rafTimer: null,
  usingNative: false,
  lastCode: '',
  lastTime: 0,
};

const videoEl = $('#video');
const scannerEl = $('#scanner');

async function nativeSupported() {
  if (!('BarcodeDetector' in window)) return false;
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats();
    return formats.includes('ean_13');
  } catch (e) {
    return false;
  }
}

async function startScanner() {
  if (scanner.active) return;
  setStatus('Avvio fotocamera…');
  $('#startBtn').classList.add('hidden');

  try {
    if (await nativeSupported()) {
      await startNative();
    } else {
      await startZXing();
    }
    scanner.active = true;
    scannerEl.classList.add('live');
    $('#stopBtn').classList.remove('hidden');
    setStatus('Fotocamera attiva — inquadra il codice a barre.');
    await setupCameraExtras();
  } catch (err) {
    console.error(err);
    $('#startBtn').classList.remove('hidden');
    let msg = 'Impossibile accedere alla fotocamera.';
    if (err && err.name === 'NotAllowedError') msg = 'Permesso fotocamera negato. Consentilo nelle impostazioni del browser.';
    else if (err && err.name === 'NotFoundError') msg = 'Nessuna fotocamera trovata su questo dispositivo.';
    else if (location.protocol !== 'https:' && location.hostname !== 'localhost') msg = 'La fotocamera richiede una connessione sicura (HTTPS). Usa il sito pubblicato su HTTPS.';
    setStatus(msg, true);
  }
}

async function getStream(deviceId) {
  const video = deviceId
    ? { deviceId: { exact: deviceId } }
    : { facingMode: { ideal: 'environment' } };
  Object.assign(video, { width: { ideal: 1280 }, height: { ideal: 720 } });
  return navigator.mediaDevices.getUserMedia({ video, audio: false });
}

async function startNative() {
  scanner.usingNative = true;
  scanner.detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
  scanner.stream = await getStream(scanner.preferredDeviceId);
  videoEl.srcObject = scanner.stream;
  await videoEl.play();
  scanLoopNative();
}

function scanLoopNative() {
  const tick = async () => {
    // Il loop si ferma quando lo stream viene rimosso (stopScanner azzera srcObject).
    if (!videoEl.srcObject) return;
    try {
      const codes = await scanner.detector.detect(videoEl);
      if (codes && codes.length) {
        handleDetection(codes[0].rawValue);
      }
    } catch (e) { /* frame non pronto */ }
    scanner.rafTimer = setTimeout(tick, 120);
  };
  tick();
}

async function startZXing() {
  scanner.usingNative = false;
  await loadZXing();
  const hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
    ZXing.BarcodeFormat.EAN_13,
    ZXing.BarcodeFormat.EAN_8,
    ZXing.BarcodeFormat.UPC_A,
    ZXing.BarcodeFormat.UPC_E,
  ]);
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  scanner.zxingReader = new ZXing.BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 });

  const constraints = {
    audio: false,
    video: scanner.preferredDeviceId
      ? { deviceId: { exact: scanner.preferredDeviceId } }
      : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
  };

  scanner.zxingControls = await scanner.zxingReader.decodeFromConstraints(
    constraints, videoEl,
    (result, err) => {
      if (result) handleDetection(result.getText());
    }
  );
  scanner.stream = videoEl.srcObject;
}

let zxingPromise = null;
function loadZXing() {
  if (window.ZXing) return Promise.resolve();
  if (zxingPromise) return zxingPromise;
  zxingPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Impossibile caricare la libreria di scansione (ZXing).'));
    document.head.appendChild(s);
  });
  return zxingPromise;
}

/** Fotocamere disponibili + torcia (se supportata). */
async function setupCameraExtras() {
  // Elenco fotocamere per il cambio
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter(d => d.kind === 'videoinput');
    const sel = $('#cameraSelect');
    if (cams.length > 1) {
      sel.innerHTML = '';
      cams.forEach((c, i) => {
        const opt = document.createElement('option');
        opt.value = c.deviceId;
        opt.textContent = c.label || `Fotocamera ${i + 1}`;
        sel.appendChild(opt);
      });
      const current = scanner.stream && scanner.stream.getVideoTracks()[0];
      const currentId = current && current.getSettings().deviceId;
      if (currentId) sel.value = currentId;
      sel.classList.remove('hidden');
    } else {
      sel.classList.add('hidden');
    }
  } catch (e) { /* enumerazione non disponibile */ }

  // Torcia
  const track = scanner.stream && scanner.stream.getVideoTracks()[0];
  const caps = track && track.getCapabilities ? track.getCapabilities() : {};
  const torchBtn = $('#torchBtn');
  if (caps && caps.torch) {
    torchBtn.classList.remove('hidden');
    torchBtn.onclick = async () => {
      scanner.torchOn = !scanner.torchOn;
      try {
        await track.applyConstraints({ advanced: [{ torch: scanner.torchOn }] });
        torchBtn.style.opacity = scanner.torchOn ? '1' : '0.6';
      } catch (e) { /* torcia non applicabile */ }
    };
  } else {
    torchBtn.classList.add('hidden');
  }
}

async function switchCamera(deviceId) {
  scanner.preferredDeviceId = deviceId;
  await stopScanner(true);
  await startScanner();
}

function stopScanner(keepPanel) {
  scanner.active = false;
  clearTimeout(scanner.rafTimer);
  if (scanner.zxingControls) {
    try { scanner.zxingControls.stop(); } catch (e) {}
    scanner.zxingControls = null;
  }
  if (scanner.zxingReader) {
    try { scanner.zxingReader.reset && scanner.zxingReader.reset(); } catch (e) {}
  }
  if (scanner.stream) {
    scanner.stream.getTracks().forEach(t => t.stop());
    scanner.stream = null;
  }
  if (videoEl.srcObject) {
    videoEl.srcObject = null;
  }
  scanner.torchOn = false;
  scannerEl.classList.remove('live');
  $('#stopBtn').classList.add('hidden');
  $('#torchBtn').classList.add('hidden');
  $('#cameraSelect').classList.add('hidden');
  if (!keepPanel) {
    $('#startBtn').classList.remove('hidden');
    setStatus('');
  }
}

function setStatus(msg, isError) {
  const el = $('#scannerStatus');
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
}

/** Chiamata quando un codice viene rilevato. */
function handleDetection(rawValue) {
  const now = Date.now();
  const code = normalizeIsbn(rawValue);
  // Anti-rimbalzo: ignora lo stesso codice ripetuto entro 3s
  if (code === scanner.lastCode && now - scanner.lastTime < 3000) return;
  scanner.lastCode = code;
  scanner.lastTime = now;

  if (!isValidIsbn(code)) return; // ignora codici non-ISBN (es. barcode del prezzo)

  beep();
  stopScanner(true);
  setStatus('Codice rilevato: ' + code);
  lookupAndShow(code);
}

/* ===========================================================
   SCHEDA RISULTATO / INSERIMENTO
   =========================================================== */

let currentBook = null; // libro in fase di inserimento/modifica

async function lookupAndShow(isbn) {
  const card = $('#resultCard');
  const loading = $('#resultLoading');
  const body = $('#resultBody');
  card.classList.remove('hidden');
  loading.classList.remove('hidden');
  body.classList.add('hidden');
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const data = await fetchBookData(isbn).catch((e) => { console.error(e); return null; });

  loading.classList.add('hidden');
  body.classList.remove('hidden');

  const existing = store.books.find(b => b.isbn === isbn);

  currentBook = data || { isbn, title: '', authors: '', publisher: '', year: '', cover: '', pages: '', categories: '' };

  $('#fTitle').value = currentBook.title || '';
  $('#fAuthors').value = currentBook.authors || '';
  $('#fPublisher').value = currentBook.publisher || '';
  $('#fYear').value = currentBook.year || '';
  $('#fIsbn').value = isbn;
  setCover($('#bookCover'), currentBook.cover);

  // Scaffale: propone l'ultimo usato come default comodo
  $('#fShelf').value = existing ? (existing.shelf || '') : (store.shelves[0] || '');

  const dup = $('#dupNote');
  if (existing) {
    dup.classList.remove('hidden');
    dup.textContent = `⚠ Questo libro è già in biblioteca (scaffale: ${existing.shelf || '—'}). Salvando ne aggiornerai i dati.`;
    $('#saveBtn').textContent = '💾 Aggiorna in biblioteca';
  } else {
    dup.classList.add('hidden');
    $('#saveBtn').textContent = '💾 Salva in biblioteca';
  }

  refreshShelfDatalists();

  if (!data || !currentBook.title) {
    setStatus('Dati non trovati automaticamente: completa i campi a mano.', true);
    $('#fTitle').focus();
  } else {
    setStatus('');
  }
}

function setCover(imgEl, url) {
  if (url) {
    imgEl.src = url;
    imgEl.style.visibility = 'visible';
  } else {
    imgEl.removeAttribute('src');
    imgEl.style.visibility = 'hidden';
  }
}

function saveCurrentBook() {
  const isbn = $('#fIsbn').value.trim();
  const title = $('#fTitle').value.trim();
  const shelf = $('#fShelf').value.trim();

  if (!title) { toast('Inserisci almeno il titolo', 'error'); $('#fTitle').focus(); return; }
  if (!shelf) { toast('Scegli o scrivi uno scaffale', 'error'); $('#fShelf').focus(); return; }

  const record = {
    id: (store.books.find(b => b.isbn === isbn) || {}).id || uid(),
    isbn,
    title,
    authors: $('#fAuthors').value.trim(),
    publisher: $('#fPublisher').value.trim(),
    year: $('#fYear').value.trim(),
    cover: currentBook ? currentBook.cover : '',
    pages: currentBook ? currentBook.pages : '',
    categories: currentBook ? currentBook.categories : '',
    shelf,
    addedAt: new Date().toISOString(),
  };

  const idx = store.books.findIndex(b => b.isbn === isbn && isbn);
  if (idx !== -1) {
    record.addedAt = store.books[idx].addedAt; // conserva la data originale
    store.books[idx] = record;
    toast('Libro aggiornato ✓', 'success');
  } else {
    store.books.unshift(record);
    toast('Libro salvato ✓', 'success');
  }

  rememberShelf(shelf, false);
  saveStore();

  refreshAll();
  resetResult();
  // Riavvia subito la scansione per aggiungere il libro successivo
  startScanner();
}

function resetResult() {
  $('#resultCard').classList.add('hidden');
  $('#resultBody').classList.add('hidden');
  currentBook = null;
}

/* ===========================================================
   DATALIST SCAFFALI
   =========================================================== */

function refreshShelfDatalists() {
  const options = store.shelves.map(s => `<option value="${escapeHtml(s)}"></option>`).join('');
  $('#shelfOptions').innerHTML = options;
  $('#shelfOptionsLibrary').innerHTML = options;

  // Filtro scaffali nella biblioteca
  const filter = $('#shelfFilter');
  const current = filter.value;
  const shelvesInUse = [...new Set(store.books.map(b => b.shelf).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'));
  filter.innerHTML = '<option value="">Tutti gli scaffali</option>' +
    shelvesInUse.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  if (shelvesInUse.includes(current)) filter.value = current;
}

/* ===========================================================
   BIBLIOTECA (rendering)
   =========================================================== */

function refreshAll() {
  refreshShelfDatalists();
  renderLibrary();
  updateCounter();
}

function updateCounter() {
  const n = store.books.length;
  $('#counter').textContent = n === 1 ? '1 libro' : `${n} libri`;
}

function renderLibrary() {
  const listEl = $('#libraryList');
  const emptyEl = $('#emptyState');
  const statsEl = $('#libraryStats');

  const query = $('#searchInput').value.trim().toLowerCase();
  const shelfFilter = $('#shelfFilter').value;
  const sort = $('#sortSelect').value;

  let books = store.books.slice();

  if (query) {
    books = books.filter(b =>
      (b.title || '').toLowerCase().includes(query) ||
      (b.authors || '').toLowerCase().includes(query) ||
      (b.isbn || '').includes(query)
    );
  }
  if (shelfFilter) books = books.filter(b => b.shelf === shelfFilter);

  // Statistiche (sull'intera biblioteca, non filtrata)
  const totalShelves = new Set(store.books.map(b => b.shelf).filter(Boolean)).size;
  statsEl.innerHTML = `<span><b>${store.books.length}</b> libri</span><span><b>${totalShelves}</b> scaffali</span>` +
    (books.length !== store.books.length ? `<span>${books.length} risultati</span>` : '');

  if (store.books.length === 0) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  // Ordinamento
  const sorters = {
    recent: (a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''),
    title: (a, b) => (a.title || '').localeCompare(b.title || '', 'it'),
    author: (a, b) => (a.authors || '').localeCompare(b.authors || '', 'it'),
    shelf: (a, b) => (a.shelf || '').localeCompare(b.shelf || '', 'it'),
  };
  books.sort(sorters[sort] || sorters.recent);

  if (books.length === 0) {
    listEl.innerHTML = `<div class="card"><p class="muted">Nessun libro corrisponde alla ricerca.</p></div>`;
    return;
  }

  // Raggruppa per scaffale quando ha senso (nessun filtro/ricerca di testo attivi o ordinamento per scaffale)
  const groupByShelf = (sort === 'shelf') || (!shelfFilter);
  if (groupByShelf) {
    const groups = {};
    for (const b of books) {
      const key = b.shelf || '— senza scaffale —';
      (groups[key] = groups[key] || []).push(b);
    }
    const keys = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'it'));
    listEl.innerHTML = keys.map(k => `
      <div class="shelf-group">
        <div class="shelf-group-title">🗂️ ${escapeHtml(k)} <span class="count">${groups[k].length}</span></div>
        ${groups[k].map(bookItemHtml).join('')}
      </div>`).join('');
  } else {
    listEl.innerHTML = books.map(bookItemHtml).join('');
  }
}

function bookItemHtml(b) {
  const cover = b.cover
    ? `<img class="cover" src="${escapeHtml(b.cover)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'cover-fallback',textContent:'📖'}))" />`
    : `<div class="cover-fallback">📖</div>`;
  const meta = [b.publisher, b.year].filter(Boolean).join(' · ');
  return `
    <div class="book-item" data-id="${escapeHtml(b.id)}">
      ${cover}
      <div class="book-info">
        <p class="title">${escapeHtml(b.title || 'Senza titolo')}</p>
        <p class="author">${escapeHtml(b.authors || '—')}</p>
        <p class="meta">${escapeHtml(meta)}${meta ? ' · ' : ''}<span class="isbn">ISBN ${escapeHtml(b.isbn || '—')}</span></p>
        <div class="book-shelf-row">
          <span aria-hidden="true">🗂️</span>
          <input class="shelf-edit" type="text" list="shelfOptionsLibrary" value="${escapeHtml(b.shelf || '')}"
                 data-id="${escapeHtml(b.id)}" placeholder="Scaffale…" aria-label="Scaffale" />
        </div>
      </div>
      <div class="book-actions">
        <button class="icon-btn" data-action="delete" data-id="${escapeHtml(b.id)}" title="Elimina">🗑️</button>
      </div>
    </div>`;
}

/* Modifica scaffale inline + eliminazione (delega eventi) */
function onLibraryListEvent(e) {
  const delBtn = e.target.closest('[data-action="delete"]');
  if (delBtn) {
    const id = delBtn.getAttribute('data-id');
    const book = store.books.find(b => b.id === id);
    if (book && confirm(`Eliminare "${book.title}" dalla biblioteca?`)) {
      store.books = store.books.filter(b => b.id !== id);
      saveStore();
      refreshAll();
      toast('Libro eliminato', '');
    }
  }
}

function onShelfEditChange(e) {
  const input = e.target.closest('.shelf-edit');
  if (!input) return;
  const id = input.getAttribute('data-id');
  const book = store.books.find(b => b.id === id);
  if (!book) return;
  const val = input.value.trim();
  if (val && val !== book.shelf) {
    book.shelf = val;
    rememberShelf(val, false);
    saveStore();
    toast('Scaffale aggiornato ✓', 'success');
    refreshShelfDatalists();
    renderLibrary();
  }
}

/* ===========================================================
   IMPORT / EXPORT
   =========================================================== */

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportJson() {
  const stamp = new Date().toISOString().slice(0, 10);
  downloadFile(`biblio-backup-${stamp}.json`, JSON.stringify(store, null, 2), 'application/json');
  toast('Backup esportato ✓', 'success');
}

function exportCsv() {
  const headers = ['Titolo', 'Autori', 'Editore', 'Anno', 'ISBN', 'Scaffale', 'Aggiunto'];
  const rows = store.books.map(b => [b.title, b.authors, b.publisher, b.year, b.isbn, b.shelf, (b.addedAt || '').slice(0, 10)]);
  const csvEscape = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const csv = '﻿' + [headers, ...rows].map(r => r.map(csvEscape).join(',')).join('\r\n');
  const stamp = new Date().toISOString().slice(0, 10);
  downloadFile(`biblio-${stamp}.csv`, csv, 'text/csv');
  toast('CSV esportato ✓', 'success');
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const incoming = Array.isArray(data) ? data : (data.books || []);
      if (!Array.isArray(incoming)) throw new Error('Formato non valido');

      let added = 0, updated = 0;
      for (const b of incoming) {
        if (!b || (!b.isbn && !b.title)) continue;
        const idx = store.books.findIndex(x => (x.isbn && x.isbn === b.isbn) || x.id === b.id);
        const rec = {
          id: b.id || uid(),
          isbn: b.isbn || '',
          title: b.title || '',
          authors: b.authors || '',
          publisher: b.publisher || '',
          year: b.year || '',
          cover: b.cover || '',
          pages: b.pages || '',
          categories: b.categories || '',
          shelf: b.shelf || '',
          addedAt: b.addedAt || new Date().toISOString(),
        };
        if (idx !== -1) { store.books[idx] = rec; updated++; }
        else { store.books.push(rec); added++; }
        if (rec.shelf) rememberShelf(rec.shelf, false);
      }
      // eventuali scaffali salvati nel backup
      if (data.shelves && Array.isArray(data.shelves)) {
        for (const s of data.shelves.slice().reverse()) rememberShelf(s, false);
      }
      saveStore();
      refreshAll();
      toast(`Importati: ${added} nuovi, ${updated} aggiornati`, 'success');
    } catch (e) {
      console.error(e);
      toast('File non valido', 'error');
    }
  };
  reader.readAsText(file);
}

/* ===========================================================
   TABS & EVENTI
   =========================================================== */

function switchTab(name) {
  $$('.tab').forEach(t => {
    const on = t.dataset.tab === name;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
  if (name === 'library') {
    stopScanner();
    renderLibrary();
  }
}

function bindEvents() {
  $$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

  $('#startBtn').addEventListener('click', startScanner);
  $('#stopBtn').addEventListener('click', () => stopScanner());
  $('#cameraSelect').addEventListener('change', (e) => switchCamera(e.target.value));

  $('#manualBtn').addEventListener('click', doManualLookup);
  $('#manualIsbn').addEventListener('keydown', (e) => { if (e.key === 'Enter') doManualLookup(); });

  $('#saveBtn').addEventListener('click', saveCurrentBook);
  $('#scanAnotherBtn').addEventListener('click', () => { resetResult(); startScanner(); });

  // Biblioteca
  $('#searchInput').addEventListener('input', renderLibrary);
  $('#shelfFilter').addEventListener('change', renderLibrary);
  $('#sortSelect').addEventListener('change', renderLibrary);
  const listEl = $('#libraryList');
  listEl.addEventListener('click', onLibraryListEvent);
  listEl.addEventListener('change', onShelfEditChange);

  // Backup
  $('#exportJsonBtn').addEventListener('click', exportJson);
  $('#exportCsvBtn').addEventListener('click', exportCsv);
  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) importJson(e.target.files[0]);
    e.target.value = '';
  });

  // Ferma la fotocamera quando la pagina va in background
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && scanner.active) stopScanner(true);
  });
}

function doManualLookup() {
  const isbn = normalizeIsbn($('#manualIsbn').value);
  if (!isValidIsbn(isbn)) {
    toast('ISBN non valido (servono 10 o 13 cifre)', 'error');
    return;
  }
  stopScanner(true);
  lookupAndShow(isbn);
  $('#manualIsbn').value = '';
}

/* ===========================================================
   SERVICE WORKER (funzionamento offline, installabile)
   =========================================================== */
function registerSW() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

/* ----------------------- Avvio ----------------------- */
function init() {
  loadStore();
  bindEvents();
  refreshAll();
  registerSW();
}

document.addEventListener('DOMContentLoaded', init);

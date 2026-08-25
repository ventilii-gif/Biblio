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

/* Fetch con timeout: evita richieste bloccate all'infinito. */
async function fetchWithTimeout(url, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
  } finally {
    clearTimeout(t);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Recupera i dati del libro interrogando più cataloghi in parallelo.
 *  Restituisce { data, outcomes }:
 *   - data: record del libro (o null se nessuna fonte utile)
 *   - outcomes: esiti per fonte, usati per spiegare eventuali fallimenti. */
async function fetchBookData(isbn) {
  const country = ((navigator.language || 'it').split('-').pop() || 'IT').toUpperCase();
  const outcomes = [];
  const onErr = (name) => (e) => { outcomes.push(`${name}: ${(e && e.message) || 'errore'}`); return null; };

  const [g, olData, olSearch] = await Promise.all([
    fetchFromGoogle(isbn, country).catch(onErr('Google')),
    fetchFromOpenLibraryData(isbn).catch(onErr('OpenLibrary')),
    fetchFromOpenLibrarySearch(isbn).catch(onErr('OL-Search')),
  ]);

  if (![g, olData, olSearch].some(Boolean)) return { data: null, outcomes };

  // Unisce i campi dalle fonti, con priorità Google > OL data > OL search.
  const pick = (k) => (g && g[k]) || (olData && olData[k]) || (olSearch && olSearch[k]) || '';
  const data = {
    isbn,
    title: pick('title'),
    authors: pick('authors'),
    publisher: pick('publisher'),
    year: pick('year'),
    cover: pick('cover') || `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false`,
    pages: pick('pages'),
    categories: pick('categories'),
  };
  if (!data.title) return { data: null, outcomes: outcomes.length ? outcomes : ['nessun catalogo ha questo ISBN'] };
  return { data, outcomes };
}

async function fetchFromGoogle(isbn, country) {
  const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}&country=${country}&maxResults=1`;
  let res = await fetchWithTimeout(url);
  // Riprova una volta in caso di limite richieste o errore temporaneo del server.
  if (res.status === 429 || res.status === 403 || res.status >= 500) {
    await sleep(800);
    res = await fetchWithTimeout(url);
  }
  if (res.status === 429 || res.status === 403) throw new Error('limite richieste (' + res.status + ')');
  if (!res.ok) throw new Error('HTTP ' + res.status);
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

async function fetchFromOpenLibraryData(isbn) {
  const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(isbn)}&format=json&jscmd=data`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  const b = data[`ISBN:${isbn}`];
  if (!b) return null;
  return {
    title: b.title || '',
    authors: (b.authors || []).map((a) => a.name).join(', '),
    publisher: (b.publishers || []).map((p) => p.name).join(', '),
    year: (b.publish_date || '').match(/\d{4}/) ? b.publish_date.match(/\d{4}/)[0] : '',
    cover: b.cover ? (b.cover.medium || b.cover.large || b.cover.small || '') : '',
    pages: b.number_of_pages || '',
    categories: (b.subjects || []).slice(0, 3).map((s) => s.name).join(', '),
  };
}

/* Open Library Search: spesso trova edizioni che l'API /api/books non espone. */
async function fetchFromOpenLibrarySearch(isbn) {
  const url = `https://openlibrary.org/search.json?isbn=${encodeURIComponent(isbn)}&fields=title,author_name,first_publish_year,publisher,cover_i,number_of_pages_median&limit=1`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  const d = data.docs && data.docs[0];
  if (!d) return null;
  return {
    title: d.title || '',
    authors: (d.author_name || []).join(', '),
    publisher: (d.publisher || [])[0] || '',
    year: d.first_publish_year ? String(d.first_publish_year) : '',
    cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : '',
    pages: d.number_of_pages_median || '',
    categories: '',
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
  setDiag('');
  $('#startBtn').classList.add('hidden');

  // Motore principale: ZXing (incluso in locale, funziona su ogni browser,
  // iPhone/Safari compresi). Solo se la libreria non si carica si ripiega
  // su BarcodeDetector nativo, dove disponibile.
  let useZxing = false;
  try { await loadZXing(); useZxing = true; }
  catch (e) { console.warn('ZXing non caricato, provo il motore nativo:', e); }

  try {
    if (useZxing) {
      await startZXing();
      scanner.engine = 'ZXing';
    } else if (await nativeSupported()) {
      await startNative();
      scanner.engine = 'BarcodeDetector';
    } else {
      throw new Error('Nessun motore di scansione disponibile su questo browser.');
    }
    scanner.active = true;
    scannerEl.classList.add('live');
    $('#stopBtn').classList.remove('hidden');
    setStatus('Fotocamera attiva — inquadra il codice a barre (EAN‑13) del libro.');
    setDiag(`Motore: ${scanner.engine} · in attesa di un codice…`);
    await setupCameraExtras();
  } catch (err) {
    console.error(err);
    $('#startBtn').classList.remove('hidden');
    let msg = 'Impossibile accedere alla fotocamera.';
    if (err && err.name === 'NotAllowedError') msg = 'Permesso fotocamera negato. Consentilo nelle impostazioni del browser.';
    else if (err && err.name === 'NotFoundError') msg = 'Nessuna fotocamera trovata su questo dispositivo.';
    else if (err && (err.name === 'NotReadableError' || err.name === 'TrackStartError')) msg = 'La fotocamera è occupata da un\'altra app. Chiudila e riprova.';
    else if (location.protocol !== 'https:' && location.hostname !== 'localhost') msg = 'La fotocamera richiede HTTPS: apri il sito pubblicato (https://…), non il file locale.';
    else if (err && err.message) msg = err.message;
    setStatus(msg, true);
  }
}

/** Vincoli video: fotocamera posteriore, alta risoluzione (per leggere le
 *  righe sottili del codice) e messa a fuoco continua dove supportata. */
function buildVideoConstraints(deviceId) {
  const v = deviceId
    ? { deviceId: { exact: deviceId } }
    : { facingMode: { ideal: 'environment' } };
  v.width = { ideal: 1920 };
  v.height = { ideal: 1080 };
  // I vincoli "advanced" non supportati vengono ignorati senza errore.
  v.advanced = [{ focusMode: 'continuous' }];
  return v;
}

async function getStream(deviceId) {
  return navigator.mediaDevices.getUserMedia({ video: buildVideoConstraints(deviceId), audio: false });
}

/** Costruisce gli "hint" ZXing limitati ai codici dei libri. */
function zxingHints() {
  const hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
    ZXing.BarcodeFormat.EAN_13,
    ZXing.BarcodeFormat.EAN_8,
    ZXing.BarcodeFormat.UPC_A,
    ZXing.BarcodeFormat.UPC_E,
  ]);
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  return hints;
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
  // 2° argomento = millisecondi tra un tentativo di lettura e il successivo.
  scanner.zxingReader = new ZXing.BrowserMultiFormatReader(zxingHints(), 100);

  const constraints = { audio: false, video: buildVideoConstraints(scanner.preferredDeviceId) };

  scanner.zxingControls = await scanner.zxingReader.decodeFromConstraints(
    constraints, videoEl,
    (result) => {
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
    // Libreria inclusa nel progetto: nessuna dipendenza da internet/CDN.
    s.src = 'vendor/zxing.min.js';
    s.onload = () => window.ZXing ? resolve() : reject(new Error('Libreria di scansione non inizializzata.'));
    s.onerror = () => reject(new Error('Impossibile caricare la libreria di scansione (vendor/zxing.min.js).'));
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

  // Messa a fuoco continua, se la fotocamera la supporta (aiuta molto la lettura).
  try {
    if (track && caps && Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
      await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    }
  } catch (e) { /* non supportato: ignora */ }
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

function setDiag(msg) {
  const el = $('#scanDiag');
  if (el) el.textContent = msg || '';
}

/** Chiamata quando un codice viene rilevato. */
function handleDetection(rawValue) {
  const now = Date.now();
  const code = normalizeIsbn(rawValue);

  // Anti-rimbalzo: ignora lo stesso codice ripetuto entro 3s
  if (code === scanner.lastCode && now - scanner.lastTime < 3000) return;
  scanner.lastCode = code;
  scanner.lastTime = now;

  if (!isValidIsbn(code)) {
    // La fotocamera legge qualcosa, ma non è un ISBN: aiuta a capire il problema.
    setDiag(`Letto "${rawValue}" — non è un ISBN. Inquadra il codice EAN‑13 grande (inizia con 978/979), non quello del prezzo.`);
    return;
  }

  beep();
  stopScanner(true);
  setStatus('Codice rilevato: ' + code);
  setDiag('');
  lookupAndShow(code);
}

/** Decodifica un codice da una foto scattata/caricata (utile se la webcam
 *  del PC non mette a fuoco: si può usare una foto nitida col telefono). */
async function decodeFromPhoto(file) {
  if (!file) return;
  setStatus('Analizzo la foto…');
  setDiag('');
  try {
    await loadZXing();
  } catch (e) {
    setStatus('Motore di scansione non disponibile.', true);
    return;
  }
  const url = URL.createObjectURL(file);
  try {
    const reader = new ZXing.BrowserMultiFormatReader(zxingHints());
    const result = await reader.decodeFromImageUrl(url);
    const code = normalizeIsbn(result.getText());
    if (!isValidIsbn(code)) {
      setStatus('', false);
      setDiag(`Nella foto ho letto "${result.getText()}", ma non è un ISBN valido.`);
      return;
    }
    beep();
    stopScanner(true);
    setStatus('Codice riconosciuto dalla foto: ' + code);
    lookupAndShow(code);
  } catch (e) {
    setStatus('', false);
    setDiag('Nessun codice riconosciuto nella foto. Riprova più da vicino, a fuoco e ben illuminato.');
  } finally {
    URL.revokeObjectURL(url);
  }
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

  const result = await fetchBookData(isbn).catch((e) => { console.error(e); return { data: null, outcomes: ['errore imprevisto: ' + (e && e.message || e)] }; });
  const data = result && result.data;
  const outcomes = (result && result.outcomes) || [];

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
    // Spiega il motivo del mancato recupero, così è chiaro cosa fare.
    const oc = outcomes.join(' · ');
    if (/limite richieste|429|403/i.test(oc)) {
      setStatus('Servizio dati al limite delle richieste: riprova tra un minuto, oppure compila a mano.', true);
    } else if (/HTTP|abort|Failed|network|Load failed/i.test(oc)) {
      setStatus('Problema di rete nel recupero dati: controlla la connessione e riprova, oppure compila a mano.', true);
    } else {
      setStatus('Questo ISBN non risulta nei cataloghi gratuiti (Google Books / Open Library): completa i campi a mano.', true);
    }
    setDiag(oc ? ('Dettaglio ricerca — ' + oc) : '');
    $('#fTitle').focus();
  } else {
    setStatus('Dati trovati ✓');
    setDiag('');
  }
}

function setCover(imgEl, url) {
  if (url) {
    imgEl.onerror = () => { imgEl.style.visibility = 'hidden'; };
    imgEl.onload = () => { imgEl.style.visibility = 'visible'; };
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

  $('#photoBtn').addEventListener('click', () => $('#photoInput').click());
  $('#photoInput').addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) decodeFromPhoto(e.target.files[0]);
    e.target.value = '';
  });

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

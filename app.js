/* ===========================================================
   Oliveto — logica dell'applicazione
   Pianificazione della raccolta delle olive, elenco del materiale,
   gestione della squadra e diario della raccolta.
   Tutti i dati restano sul dispositivo (localStorage).
   =========================================================== */

'use strict';

/* ----------------------- Costanti di dominio ----------------------- */
const DENSITY_OIL = 0.916;                 // densità dell'olio (kg per litro)
const METHOD_LABEL = {
  manuale: 'a mano (brucatura)',
  agevolata: 'agevolata (abbacchiatori)',
  mista: 'mista',
};
// Piante che una persona riesce a raccogliere in un'ora, per metodo.
// Moltiplicate per le ore/giorno danno le piante per persona al giorno.
const TREES_PER_PERSON_HOUR = { manuale: 0.8, agevolata: 2.0, mista: 1.3 };

/* ----------------------- Stato & storage ----------------------- */
const STORAGE_KEY = 'oliveto.data.v1';

const DEFAULT_PLAN = {
  trees: 100,
  method: 'agevolata',
  yieldPerTree: 20,   // kg di olive per pianta
  oilYield: 15,       // resa in olio (%)
  hoursPerDay: 6,
  tppd: null,         // piante/persona/giorno (override manuale)
  startDate: '',
  targetDays: null,   // giorni a disposizione (facoltativo)
  dailyCost: null,    // costo a persona al giorno (€, facoltativo)
};

const store = {
  plan: { ...DEFAULT_PLAN },
  people: [],           // { id, name, role, days, phone }
  sessions: [],         // { id, date, trees, kg, people, hours, oilLiters, note, createdAt }
  materialState: {},    // { [key]: { done, qty, hidden } } — stato delle voci predefinite
  customMaterials: [],  // { id, name, icon, cat, unit, qty, note, done }
  mill: { name: '', date: '', qty: null, note: '' }, // frantoio / appuntamento
};

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.plan && typeof data.plan === 'object') store.plan = { ...DEFAULT_PLAN, ...data.plan };
    if (Array.isArray(data.people)) store.people = data.people;
    if (Array.isArray(data.sessions)) store.sessions = data.sessions;
    if (data.materialState && typeof data.materialState === 'object') store.materialState = data.materialState;
    if (Array.isArray(data.customMaterials)) store.customMaterials = data.customMaterials;
    if (data.mill && typeof data.mill === 'object') store.mill = { ...store.mill, ...data.mill };
  } catch (e) {
    console.warn('Impossibile leggere i dati salvati:', e);
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

/* ----------------------- Utilità ----------------------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Numero da input (accetta anche la virgola come separatore decimale). */
function num(v) {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(',', '.').trim());
  return isFinite(n) ? n : 0;
}

/** Formatta un numero in stile italiano. */
function fmt(n, decimals = 0) {
  return new Intl.NumberFormat('it-IT', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: 0,
  }).format(isFinite(n) ? n : 0);
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(d)) return iso;
  return new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: 'long', year: 'numeric' }).format(d);
}

function fmtDateTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d)) return v;
  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(d);
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '🙂';
  return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
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

/* ===========================================================
   CALCOLI
   =========================================================== */

/** Piante raccolte da una persona in un giorno (override o stima dal metodo). */
function treesPerPersonDay(plan = store.plan) {
  const override = num(plan.tppd);
  if (override > 0) return override;
  const perHour = TREES_PER_PERSON_HOUR[plan.method] || TREES_PER_PERSON_HOUR.mista;
  return Math.max(1, Math.round(perHour * (num(plan.hoursPerDay) || 6)));
}

/** Stime complessive a partire dal piano. */
function planTotals() {
  const p = store.plan;
  const trees = Math.max(0, num(p.trees));
  const kgOlives = trees * Math.max(0, num(p.yieldPerTree));
  const oilKg = kgOlives * Math.max(0, num(p.oilYield)) / 100;
  const oilL = oilKg / DENSITY_OIL;
  const tppd = treesPerPersonDay(p);
  const personDays = tppd > 0 ? trees / tppd : 0; // giornate-persona totali
  const dailyCost = Math.max(0, num(p.dailyCost));
  const laborCost = personDays * dailyCost;
  const costPerLiter = oilL > 0 ? laborCost / oilL : 0;
  return { trees, kgOlives, oilKg, oilL, tppd, personDays, dailyCost, laborCost, costPerLiter };
}

/** Totali già raccolti (dal diario). */
function progressTotals() {
  let trees = 0, kg = 0, oil = 0, personDays = 0;
  const p = store.plan;
  const hpd = num(p.hoursPerDay) || 6;
  for (const s of store.sessions) {
    trees += num(s.trees);
    kg += num(s.kg);
    oil += num(s.oilLiters);
    personDays += (num(s.people) * num(s.hours)) / hpd;
  }
  return { trees, kg, oil, personDays, days: store.sessions.length };
}

/** Squadra: numero persone e giornate-persona disponibili. */
function teamTotals() {
  const count = store.people.length;
  let personDays = 0;
  for (const p of store.people) personDays += num(p.days);
  return { count, personDays };
}

/* ===========================================================
   MATERIALE — elenco consigliato (si adatta a piante/squadra/metodo)
   =========================================================== */

const MATERIALS = [
  { key: 'reti', icon: '🕸️', name: 'Reti / teli da raccolta (grandi)', cat: 'raccolta', unit: 'teli',
    note: 'Da stendere sotto le piante per raccogliere le olive.',
    qty: (c) => Math.max(4, c.team * 2) },
  { key: 'abbacchiatori', icon: '⚡', name: 'Abbacchiatori elettrici o pneumatici', cat: 'raccolta', unit: 'attrezzi',
    note: 'Circa uno ogni due persone.', methods: ['agevolata', 'mista'],
    qty: (c) => Math.max(1, Math.ceil(c.team / 2)) },
  { key: 'batterie', icon: '🔋', name: 'Batterie di ricambio / gruppo elettrogeno', cat: 'raccolta', unit: 'pz',
    note: 'Per non fermarsi a metà giornata.', methods: ['agevolata', 'mista'],
    qty: (c) => Math.max(1, Math.ceil(c.team / 2)) },
  { key: 'rastrelli', icon: '🧹', name: 'Rastrelli / pettini manuali', cat: 'raccolta', unit: 'pz',
    note: 'Utili anche per rifinire le piante.',
    qty: (c) => Math.max(2, c.team) },
  { key: 'scale', icon: '🪜', name: 'Scale per le piante alte', cat: 'raccolta', unit: 'scale',
    note: 'Circa una ogni tre persone.',
    qty: (c) => Math.max(1, Math.ceil(c.team / 3)) },
  { key: 'cesoie', icon: '✂️', name: 'Cesoie / svettatoio', cat: 'raccolta', unit: 'pz',
    note: 'Per i rami più difficili da raggiungere.',
    qty: (c) => Math.max(1, Math.ceil(c.team / 2)) },
  { key: 'cassette', icon: '🧺', name: 'Cassette forate (max ~20 kg)', cat: 'trasporto', unit: 'cassette',
    note: 'Le olive non vanno ammassate: si scaldano e rovinano l\'olio.',
    qty: (c) => Math.max(6, Math.ceil(c.kgPerDay / 20)) },
  { key: 'bilancia', icon: '⚖️', name: 'Bilancia', cat: 'trasporto', unit: 'pz',
    note: 'Per pesare le olive prima del frantoio.',
    qty: () => 1 },
  { key: 'trasporto', icon: '🚜', name: 'Mezzo per il trasporto al frantoio', cat: 'trasporto', unit: '',
    note: 'Ape, rimorchio o furgone.',
    qty: () => 1 },
  { key: 'guanti', icon: '🧤', name: 'Guanti da lavoro', cat: 'sicurezza', unit: 'paia',
    note: 'Un paio a persona.',
    qty: (c) => Math.max(2, c.team) },
  { key: 'prontosoccorso', icon: '🩹', name: 'Kit di primo soccorso', cat: 'sicurezza', unit: 'pz',
    note: 'Anche solo per graffi e punture.',
    qty: () => 1 },
  { key: 'acqua', icon: '💧', name: 'Acqua e viveri per la squadra', cat: 'sicurezza', unit: '',
    note: 'Per tutta la giornata di lavoro.',
    qty: () => 1 },
  { key: 'pioggia', icon: '⛅', name: 'Teli impermeabili (riparo pioggia)', cat: 'organizzazione', unit: 'teli',
    note: 'Per riparare olive e attrezzi in caso di pioggia.',
    qty: () => 2 },
  { key: 'frantoio', icon: '🏭', name: 'Prenotazione al frantoio', cat: 'organizzazione', unit: '',
    note: 'Prenota il turno: nei giorni di punta c\'è coda.',
    qty: () => 1 },
  { key: 'meteo', icon: '🌦️', name: 'Controllo del meteo', cat: 'organizzazione', unit: '',
    note: 'Pianifica le giornate con il tempo migliore.',
    qty: () => 1 },
];

const CAT_LABEL = {
  raccolta: '🫒 Attrezzi di raccolta',
  trasporto: '📦 Contenitori e trasporto',
  sicurezza: '🦺 Persone e sicurezza',
  organizzazione: '🗓️ Meteo e organizzazione',
};
const CAT_ORDER = ['raccolta', 'trasporto', 'sicurezza', 'organizzazione'];

/** Contesto per calcolare le quantità consigliate. */
function matContext() {
  const t = planTotals();
  const team = teamTotals();
  const fallbackTeam = num(store.plan.targetDays) > 0
    ? Math.max(1, Math.ceil(t.personDays / num(store.plan.targetDays)))
    : 4;
  const teamSize = team.count > 0 ? team.count : fallbackTeam;
  const kgPerPersonDay = Math.max(0, num(store.plan.yieldPerTree)) * t.tppd;
  const kgPerDay = teamSize * kgPerPersonDay;
  return { team: teamSize, kgPerDay, trees: t.trees, isFallbackTeam: team.count === 0, fallbackTeam };
}

/** Costruisce l'elenco delle voci di materiale (predefinite + personalizzate). */
function matItems() {
  const c = matContext();
  const items = [];
  for (const def of MATERIALS) {
    if (def.methods && !def.methods.includes(store.plan.method)) continue;
    const st = store.materialState[def.key] || {};
    if (st.hidden) continue;
    const suggested = Math.max(0, Math.round(def.qty(c)));
    const qty = (st.qty != null && st.qty !== '') ? num(st.qty) : suggested;
    items.push({
      type: 'def', ref: def.key, icon: def.icon, name: def.name, cat: def.cat,
      unit: def.unit, note: def.note, qty, suggested, done: !!st.done,
    });
  }
  for (const m of store.customMaterials) {
    items.push({
      type: 'cus', ref: m.id, icon: m.icon || '📌', name: m.name, cat: m.cat || 'organizzazione',
      unit: m.unit || '', note: m.note || '', qty: num(m.qty), done: !!m.done, custom: true,
    });
  }
  return items;
}

function hiddenCount() {
  return MATERIALS.filter(def => {
    if (def.methods && !def.methods.includes(store.plan.method)) return false;
    return store.materialState[def.key] && store.materialState[def.key].hidden;
  }).length;
}

/* ===========================================================
   RENDER
   =========================================================== */

function renderCounter() {
  const t = planTotals();
  const prog = progressTotals();
  const pct = t.trees > 0 ? Math.min(100, Math.round((prog.trees / t.trees) * 100)) : 0;
  $('#counter').textContent = `${pct}% raccolto`;
}

function renderPlanStats() {
  const t = planTotals();
  const team = teamTotals();
  const p = store.plan;

  $('#tppdAuto').textContent = fmt(treesPerPersonDay(p));

  const tiles = [];
  tiles.push(stat(`${fmt(t.kgOlives)} kg`, '🫒 Olive stimate', `resa ${fmt(num(p.yieldPerTree), 1)} kg/pianta`));
  tiles.push(stat(`~${fmt(t.oilL)} L`, '🫗 Olio stimato', `a resa ${fmt(num(p.oilYield), 1)}%`, 'oil'));
  tiles.push(stat(`${fmt(t.personDays, 1)}`, '👷 Giornate-persona', `${fmt(t.tppd)} piante/persona al giorno`));

  if (team.count > 0) {
    const days = t.personDays > 0 ? Math.ceil(t.personDays / team.count) : 0;
    tiles.push(stat(`${fmt(days)} ${days === 1 ? 'giorno' : 'giorni'}`, '📅 Durata stimata', `con ${team.count} ${team.count === 1 ? 'persona' : 'persone'}`));
  } else {
    tiles.push(stat('—', '📅 Durata stimata', 'aggiungi la squadra'));
  }

  const targetDays = num(p.targetDays);
  if (targetDays > 0) {
    const recPeople = t.personDays > 0 ? Math.ceil(t.personDays / targetDays) : 0;
    tiles.push(stat(`${fmt(recPeople)} ${recPeople === 1 ? 'persona' : 'persone'}`, '🎯 Servono', `per finire in ${fmt(targetDays)} giorni`));
  }

  if (t.dailyCost > 0) {
    const sub = t.costPerLiter > 0 ? `≈ € ${fmt(t.costPerLiter, 2)} al litro d'olio` : `€ ${fmt(t.dailyCost)}/persona al giorno`;
    tiles.push(stat(`€ ${fmt(t.laborCost)}`, '💶 Costo manodopera', sub, 'cost'));
  }

  $('#planStats').innerHTML = tiles.join('');
  $('#planNote').innerHTML = planNoteText();
}

function stat(val, label, sub, cls = '') {
  return `<div class="stat ${cls}">
    <div class="stat-val">${escapeHtml(val)}</div>
    <div class="stat-label">${escapeHtml(label)}</div>
    <div class="stat-sub">${escapeHtml(sub)}</div>
  </div>`;
}

function planNoteText() {
  const t = planTotals();
  const team = teamTotals();
  if (t.trees <= 0) return 'Inserisci il numero di piante per vedere le stime.';
  let s = `Con <b>${fmt(t.trees)} piante</b> e una resa di ${fmt(num(store.plan.yieldPerTree), 1)} kg a pianta, stimi circa <b>${fmt(t.kgOlives)} kg di olive</b> → <b>~${fmt(t.oilL)} litri d'olio</b> (raccolta ${METHOD_LABEL[store.plan.method]}). `;
  if (team.count > 0 && t.personDays > 0) {
    const days = Math.ceil(t.personDays / team.count);
    s += `Con la tua squadra di <b>${team.count}</b> ${team.count === 1 ? 'persona' : 'persone'} servono circa <b>${fmt(days)} ${days === 1 ? 'giorno' : 'giorni'}</b> di lavoro.`;
  } else {
    const four = Math.ceil(t.personDays / 4);
    s += `Servono circa <b>${fmt(t.personDays, 1)} giornate-persona</b>: per esempio ${four} ${four === 1 ? 'giorno' : 'giorni'} con 4 persone. Aggiungi la squadra nella scheda 👥.`;
  }
  return s;
}

function renderMill() {
  const m = store.mill || {};
  const t = planTotals();
  const qtyEl = $('#mQty');
  if (qtyEl) qtyEl.placeholder = t.kgOlives > 0 ? `stima ${fmt(t.kgOlives)} kg` : 'kg';

  const banner = $('#millBanner');
  if (!banner) return;
  if (m.date) {
    const q = num(m.qty) > 0 ? ` · ${fmt(num(m.qty))} kg` : '';
    const name = m.name ? ` · ${escapeHtml(m.name)}` : '';
    banner.className = 'coverage ok';
    banner.innerHTML = `📅 Appuntamento: <b>${escapeHtml(fmtDateTime(m.date))}</b>${name}${q}`;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

function progressHtml() {
  const t = planTotals();
  const prog = progressTotals();
  const bars = [
    bar('🫒 Piante raccolte', prog.trees, t.trees, `${fmt(prog.trees)} / ${fmt(t.trees)}`),
    bar('⚖️ Olive raccolte', prog.kg, t.kgOlives, `${fmt(prog.kg)} kg su ~${fmt(t.kgOlives)} kg`),
    bar('🫗 Olio ottenuto', prog.oil, t.oilL, `${fmt(prog.oil, 1)} L su ~${fmt(t.oilL)} L`, 'oil'),
  ];
  return bars.join('');
}

function bar(label, value, total, valueText, cls = '') {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return `<div class="prog">
    <div class="prog-head"><span>${escapeHtml(label)}</span><span class="val">${escapeHtml(valueText)}</span></div>
    <div class="prog-bar"><div class="prog-fill ${cls}" data-pct="${pct}"></div></div>
  </div>`;
}

function renderProgress() {
  const html = progressHtml();
  $('#planProgress').innerHTML = html;
  $('#harvestProgress').innerHTML = html;
  // Larghezza impostata via JS (CSSOM) per non usare stili inline nell'HTML:
  // così la Content Security Policy può vietare gli stili inline.
  $$('.prog-fill').forEach(el => { el.style.width = (Number(el.dataset.pct) || 0) + '%'; });
}

function renderMaterials() {
  const items = matItems();
  const total = items.length;
  const done = items.filter(i => i.done).length;
  const c = matContext();

  let summary = `<span><span class="big">${done}</span> di <b>${total}</b> voci pronte</span>`;
  if (c.isFallbackTeam) {
    summary += `<span class="muted">quantità stimate per ${c.fallbackTeam} persone — aggiungi la squadra per affinarle</span>`;
  }
  $('#matSummary').innerHTML = summary;

  const groups = CAT_ORDER.map(cat => {
    const list = items.filter(i => i.cat === cat);
    if (!list.length) return '';
    return `<div class="mat-group">
      <div class="mat-group-title">${escapeHtml(CAT_LABEL[cat] || cat)}</div>
      ${list.map(matRow).join('')}
    </div>`;
  }).join('');
  $('#matList').innerHTML = groups || '<div class="empty-state"><span class="empty-icon">🧰</span><p>Nessuna voce in elenco.</p></div>';

  const hidden = hiddenCount();
  $('#restoreMatBtn').classList.toggle('hidden', hidden === 0);
  if (hidden > 0) $('#restoreMatBtn').textContent = `↺ Ripristina ${hidden} nascoste`;

  const t = planTotals();
  const team = teamTotals();
  const when = fmtDate(new Date().toISOString().slice(0, 10));
  $('#printHeader').innerHTML = `<h2>🫒 Oliveto — elenco del materiale</h2>
    <div class="ph-sub">${fmt(t.trees)} piante · ${team.count > 0 ? team.count + ' persone' : 'squadra da definire'} · ${done}/${total} voci pronte · stampato il ${when}</div>`;
}

function matRow(i) {
  const showQty = !!i.unit || i.qty > 1;
  const qtyHtml = showQty
    ? `<div class="mat-qty">
         <input type="number" min="0" step="any" inputmode="decimal" value="${i.qty}"
                data-act="qty" data-type="${i.type}" data-ref="${i.ref}" aria-label="Quantità" />
         <span class="unit">${escapeHtml(i.unit)}</span>
       </div>`
    : '';
  const custom = i.custom ? '<span class="tag-custom">tua</span>' : '';
  return `<div class="mat-item ${i.done ? 'done' : ''}">
    <label class="mat-check">
      <input type="checkbox" ${i.done ? 'checked' : ''} data-act="done" data-type="${i.type}" data-ref="${i.ref}" aria-label="Pronto" />
    </label>
    <div class="mat-main">
      <div class="mat-name"><span class="mat-icon">${i.icon}</span>${escapeHtml(i.name)}${custom}</div>
      ${i.note ? `<div class="mat-note">${escapeHtml(i.note)}</div>` : ''}
    </div>
    ${qtyHtml}
    <button class="icon-btn" data-act="del" data-type="${i.type}" data-ref="${i.ref}" title="Rimuovi">🗑️</button>
  </div>`;
}

function renderTeam() {
  const team = teamTotals();
  const t = planTotals();

  let summary = `<span>👥 <b>${team.count}</b> ${team.count === 1 ? 'persona' : 'persone'}</span>`;
  summary += `<span>🗓️ <b>${fmt(team.personDays, 1)}</b> giornate-persona disponibili</span>`;
  $('#teamSummary').innerHTML = summary;

  // Copertura del lavoro stimato
  const cov = $('#teamCoverage') || (() => {
    const el = document.createElement('div');
    el.id = 'teamCoverage';
    $('#teamSummary').after(el);
    return el;
  })();
  if (team.count > 0 && t.personDays > 0) {
    const pct = Math.round((team.personDays / t.personDays) * 100);
    if (team.personDays >= t.personDays) {
      cov.className = 'coverage ok';
      cov.innerHTML = `✅ La squadra copre circa il <b>${fmt(pct)}%</b> del lavoro stimato (${fmt(t.personDays, 1)} giornate-persona).`;
    } else {
      const missing = t.personDays - team.personDays;
      cov.className = 'coverage low';
      cov.innerHTML = `⚠️ La squadra copre circa il <b>${fmt(pct)}%</b>: mancano ~<b>${fmt(missing, 1)}</b> giornate-persona (più persone o più giorni).`;
    }
  } else {
    cov.className = 'coverage';
    cov.innerHTML = 'Indica i giorni disponibili di ciascuno per vedere se la squadra basta.';
  }

  const list = $('#teamList');
  if (!store.people.length) {
    list.innerHTML = '';
    $('#teamEmpty').classList.remove('hidden');
    return;
  }
  $('#teamEmpty').classList.add('hidden');
  list.innerHTML = store.people.map(personRow).join('');
}

function personRow(p) {
  const phone = p.phone
    ? `<a class="phone" href="tel:${escapeHtml(String(p.phone).replace(/\s/g, ''))}">📞 ${escapeHtml(p.phone)}</a>`
    : '';
  return `<div class="person">
    <div class="avatar">${escapeHtml(initials(p.name))}</div>
    <div class="person-info">
      <div class="name">${escapeHtml(p.name)}</div>
      <div class="role">${escapeHtml(p.role || 'Raccoglitore/trice')}</div>
      ${phone}
    </div>
    <div class="person-days">
      <input type="number" min="0" step="any" inputmode="decimal" value="${num(p.days)}"
             data-person-days="${p.id}" aria-label="Giorni disponibili" />
      <span class="lbl">gg</span>
    </div>
    <button class="icon-btn" data-person-del="${p.id}" title="Rimuovi">🗑️</button>
  </div>`;
}

function renderHarvest() {
  const list = $('#sessionList');
  if (!store.sessions.length) {
    list.innerHTML = '';
    $('#sessionEmpty').classList.remove('hidden');
    return;
  }
  $('#sessionEmpty').classList.add('hidden');
  const sorted = store.sessions.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  list.innerHTML = sorted.map(sessionRow).join('');
}

function sessionRow(s) {
  const badges = [];
  if (num(s.trees)) badges.push(`<span class="badge olive">🫒 ${fmt(num(s.trees))} piante</span>`);
  if (num(s.kg)) badges.push(`<span class="badge">⚖️ ${fmt(num(s.kg))} kg</span>`);
  if (num(s.people)) badges.push(`<span class="badge">👥 ${fmt(num(s.people))}</span>`);
  if (num(s.hours)) badges.push(`<span class="badge">⏱️ ${fmt(num(s.hours), 1)} h</span>`);
  if (num(s.oilLiters)) badges.push(`<span class="badge oil">🫗 ${fmt(num(s.oilLiters), 1)} L</span>`);
  return `<div class="session">
    <div class="session-head">
      <span class="session-date">${escapeHtml(fmtDate(s.date))}</span>
      <button class="icon-btn" data-session-del="${s.id}" title="Elimina">🗑️</button>
    </div>
    <div class="session-badges">${badges.join('') || '<span class="badge">nessun dato</span>'}</div>
    ${s.note ? `<div class="session-note">📝 ${escapeHtml(s.note)}</div>` : ''}
  </div>`;
}

/** Ridisegna tutte le parti derivate dallo stato. */
function renderDerived() {
  renderCounter();
  renderPlanStats();
  renderMill();
  renderProgress();
  renderMaterials();
  renderTeam();
}

function renderAll() {
  renderDerived();
  renderHarvest();
}

/* ----------------------- Idratazione dei campi del piano ----------------------- */
function hydrateInputs() {
  const p = store.plan;
  $('#pTrees').value = p.trees ?? '';
  $('#pMethod').value = p.method || 'agevolata';
  $('#pYield').value = p.yieldPerTree ?? '';
  $('#pOil').value = p.oilYield ?? '';
  $('#pHours').value = p.hoursPerDay ?? '';
  $('#pStart').value = p.startDate || '';
  $('#pDays').value = p.targetDays ?? '';
  $('#pCost').value = p.dailyCost ?? '';
  $('#pTppd').value = p.tppd ?? '';
  $('#pScenario').value = '';
  const m = store.mill || {};
  $('#mName').value = m.name || '';
  $('#mDate').value = m.date || '';
  $('#mQty').value = m.qty != null ? m.qty : '';
  $('#mNote').value = m.note || '';
  // Data di default per una nuova giornata: oggi
  if (!$('#sDate').value) $('#sDate').value = new Date().toISOString().slice(0, 10);
}

/* ===========================================================
   BACKUP / IMPORT / EXPORT
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
  downloadFile(`oliveto-backup-${stamp}.json`, JSON.stringify(store, null, 2), 'application/json');
  toast('Backup esportato ✓', 'success');
}

function exportCsv() {
  if (!store.sessions.length) { toast('Nessuna giornata da esportare', 'error'); return; }
  const headers = ['Data', 'Piante', 'Olive (kg)', 'Persone', 'Ore', 'Olio (L)', 'Note'];
  const rows = store.sessions
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map(s => [s.date, num(s.trees), num(s.kg), num(s.people), num(s.hours), num(s.oilLiters), s.note || '']);
  const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const csv = '﻿' + [headers, ...rows].map(r => r.map(esc).join(';')).join('\r\n');
  const stamp = new Date().toISOString().slice(0, 10);
  downloadFile(`oliveto-raccolta-${stamp}.csv`, csv, 'text/csv');
  toast('CSV esportato ✓', 'success');
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (data.plan && typeof data.plan === 'object') store.plan = { ...DEFAULT_PLAN, ...data.plan };
      if (Array.isArray(data.people)) store.people = data.people;
      if (Array.isArray(data.sessions)) store.sessions = data.sessions;
      if (data.materialState && typeof data.materialState === 'object') store.materialState = data.materialState;
      if (Array.isArray(data.customMaterials)) store.customMaterials = data.customMaterials;
      if (data.mill && typeof data.mill === 'object') store.mill = { name: '', date: '', qty: null, note: '', ...data.mill };
      saveStore();
      hydrateInputs();
      renderAll();
      toast('Backup importato ✓', 'success');
    } catch (e) {
      console.error(e);
      toast('File non valido', 'error');
    }
  };
  reader.readAsText(file);
}

/* ===========================================================
   EVENTI — PIANO
   =========================================================== */

function wirePlan() {
  const bind = (id, key, isNumber, allowNull) => {
    $(id).addEventListener('input', (e) => {
      const raw = e.target.value;
      if (isNumber) {
        store.plan[key] = (allowNull && raw === '') ? null : num(raw);
      } else {
        store.plan[key] = raw;
      }
      saveStore();
      renderDerived();
    });
  };
  bind('#pTrees', 'trees', true);
  bind('#pYield', 'yieldPerTree', true);
  bind('#pOil', 'oilYield', true);
  bind('#pHours', 'hoursPerDay', true);
  bind('#pStart', 'startDate', false);
  bind('#pDays', 'targetDays', true, true);
  bind('#pCost', 'dailyCost', true, true);
  bind('#pTppd', 'tppd', true, true);

  $('#pMethod').addEventListener('change', (e) => {
    store.plan.method = e.target.value;
    saveStore();
    renderDerived();
  });

  // Scenario tipico: riempie resa per pianta e resa in olio
  $('#pScenario').addEventListener('change', (e) => {
    const opt = e.target.selectedOptions[0];
    if (!opt || !opt.value) return;
    if (opt.dataset.yield != null) { store.plan.yieldPerTree = num(opt.dataset.yield); $('#pYield').value = opt.dataset.yield; }
    if (opt.dataset.oil != null) { store.plan.oilYield = num(opt.dataset.oil); $('#pOil').value = opt.dataset.oil; }
    saveStore();
    renderDerived();
  });
  // Se l'utente modifica a mano le rese, lo scenario torna "Personalizzato"
  $('#pYield').addEventListener('input', () => { $('#pScenario').value = ''; });
  $('#pOil').addEventListener('input', () => { $('#pScenario').value = ''; });

  // Frantoio / appuntamento
  const bindMill = (id, key, isNumber) => {
    $(id).addEventListener('input', (e) => {
      const raw = e.target.value;
      store.mill[key] = isNumber ? (raw === '' ? null : num(raw)) : raw;
      saveStore();
      renderMill();
    });
  };
  bindMill('#mName', 'name', false);
  bindMill('#mDate', 'date', false);
  bindMill('#mQty', 'qty', true);
  bindMill('#mNote', 'note', false);

  $('#exportJsonBtn').addEventListener('click', exportJson);
  $('#exportCsvBtn').addEventListener('click', exportCsv);
  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', (e) => {
    if (e.target.files[0]) importJson(e.target.files[0]);
    e.target.value = '';
  });
  $('#resetBtn').addEventListener('click', () => {
    if (!confirm('Azzerare tutti i dati (piano, squadra, materiale e raccolta)? L\'operazione non è reversibile.')) return;
    store.plan = { ...DEFAULT_PLAN };
    store.people = [];
    store.sessions = [];
    store.materialState = {};
    store.customMaterials = [];
    store.mill = { name: '', date: '', qty: null, note: '' };
    saveStore();
    hydrateInputs();
    renderAll();
    toast('Dati azzerati', 'success');
  });

  $$('[data-goto]').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.goto)));
}

/* ===========================================================
   EVENTI — MATERIALE
   =========================================================== */

function setMatState(key, patch) {
  store.materialState[key] = { ...(store.materialState[key] || {}), ...patch };
}

function wireMaterials() {
  $('#matList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act="del"]');
    if (!btn) return;
    const { type, ref } = btn.dataset;
    if (type === 'cus') {
      store.customMaterials = store.customMaterials.filter(m => m.id !== ref);
    } else {
      setMatState(ref, { hidden: true });
    }
    saveStore();
    renderMaterials();
  });

  $('#matList').addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.act === 'done') {
      const { type, ref } = el.dataset;
      if (type === 'cus') {
        const m = store.customMaterials.find(x => x.id === ref);
        if (m) m.done = el.checked;
      } else {
        setMatState(ref, { done: el.checked });
      }
      saveStore();
      renderMaterials();
    } else if (el.dataset.act === 'qty') {
      const { type, ref } = el.dataset;
      const v = num(el.value);
      if (type === 'cus') {
        const m = store.customMaterials.find(x => x.id === ref);
        if (m) m.qty = v;
      } else {
        setMatState(ref, { qty: v });
      }
      saveStore();
      renderMaterials();
    }
  });

  $('#addMatBtn').addEventListener('click', () => {
    const f = $('#matForm');
    f.classList.toggle('hidden');
    if (!f.classList.contains('hidden')) $('#mfName').focus();
  });
  $('#mfCancel').addEventListener('click', () => {
    $('#matForm').reset();
    $('#matForm').classList.add('hidden');
  });
  $('#matForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#mfName').value.trim();
    if (!name) { toast('Scrivi cosa serve', 'error'); return; }
    store.customMaterials.push({
      id: uid(),
      name,
      icon: '📌',
      cat: $('#mfCat').value,
      unit: $('#mfUnit').value.trim(),
      qty: num($('#mfQty').value),
      note: $('#mfNote').value.trim(),
      done: false,
    });
    saveStore();
    $('#matForm').reset();
    $('#matForm').classList.add('hidden');
    renderMaterials();
    toast('Voce aggiunta ✓', 'success');
  });

  $('#restoreMatBtn').addEventListener('click', () => {
    for (const key of Object.keys(store.materialState)) {
      if (store.materialState[key]) store.materialState[key].hidden = false;
    }
    saveStore();
    renderMaterials();
  });

  $('#printMatBtn').addEventListener('click', () => window.print());
}

/* ===========================================================
   EVENTI — SQUADRA
   =========================================================== */

function wireTeam() {
  $('#personForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#npName').value.trim();
    if (!name) { toast('Scrivi il nome', 'error'); return; }
    store.people.push({
      id: uid(),
      name,
      role: $('#npRole').value.trim(),
      days: num($('#npDays').value),
      phone: $('#npPhone').value.trim(),
    });
    saveStore();
    $('#personForm').reset();
    renderDerived();
    $('#npName').focus();
    toast('Persona aggiunta ✓', 'success');
  });

  $('#teamList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-person-del]');
    if (!btn) return;
    store.people = store.people.filter(p => p.id !== btn.dataset.personDel);
    saveStore();
    renderDerived();
  });

  $('#teamList').addEventListener('change', (e) => {
    const el = e.target.closest('[data-person-days]');
    if (!el) return;
    const p = store.people.find(x => x.id === el.dataset.personDays);
    if (p) { p.days = num(el.value); saveStore(); renderDerived(); }
  });
}

/* ===========================================================
   EVENTI — RACCOLTA
   =========================================================== */

function wireHarvest() {
  $('#sessionForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const date = $('#sDate').value || new Date().toISOString().slice(0, 10);
    const rec = {
      id: uid(),
      date,
      trees: num($('#sTrees').value),
      kg: num($('#sKg').value),
      people: num($('#sPeople').value),
      hours: num($('#sHours').value),
      oilLiters: num($('#sOil').value),
      note: $('#sNote').value.trim(),
      createdAt: new Date().toISOString(),
    };
    if (!rec.trees && !rec.kg && !rec.oilLiters) {
      toast('Inserisci almeno piante, kg o litri', 'error');
      return;
    }
    store.sessions.push(rec);
    saveStore();
    $('#sessionForm').reset();
    $('#sDate').value = new Date().toISOString().slice(0, 10);
    renderAll();
    toast('Giornata salvata ✓', 'success');
  });

  $('#sessionList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-session-del]');
    if (!btn) return;
    if (!confirm('Eliminare questa giornata?')) return;
    store.sessions = store.sessions.filter(s => s.id !== btn.dataset.sessionDel);
    saveStore();
    renderAll();
  });
}

/* ===========================================================
   TABS & INIT
   =========================================================== */

function switchTab(name) {
  $$('.tab').forEach(t => {
    const on = t.dataset.tab === name;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function init() {
  loadStore();
  hydrateInputs();
  $$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  wirePlan();
  wireMaterials();
  wireTeam();
  wireHarvest();
  renderAll();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
}

document.addEventListener('DOMContentLoaded', init);

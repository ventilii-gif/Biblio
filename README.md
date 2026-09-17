# 🫒 Oliveto — gestione della raccolta

Web app per **organizzare la raccolta delle olive**. Imposti i numeri del tuo
terreno (per esempio **100 piante**) e l'app calcola da sola quante olive e
quanto olio puoi aspettarti, quante **persone** servono e per quanti **giorni**,
prepara l'**elenco del materiale** necessario adattato alla tua squadra e ti
tiene il **diario della raccolta** con l'avanzamento.

Non serve installare nulla né registrarsi: è un sito statico e tutti i dati
restano **sul tuo dispositivo**.

## ✨ Funzioni

- 📋 **Piano e stime**: dai il numero di piante, il metodo di raccolta, la resa
  per pianta e la resa in olio → ottieni **olive stimate (kg)**, **olio stimato
  (L)**, **giornate-persona** di lavoro, **durata** con la tua squadra e le
  **persone necessarie** per finire entro i giorni che hai a disposizione.
- 🧰 **Elenco del materiale**: una checklist consigliata (reti, abbacchiatori,
  batterie, scale, cassette, guanti, primo soccorso, mezzo per il frantoio…)
  con **quantità che si adattano** al numero di piante e di persone. Spunti ciò
  che è pronto, correggi le quantità, aggiungi voci tue e **stampi** la lista.
- 👥 **Squadra**: aggiungi chi collabora con ruolo, giorni disponibili e
  telefono; l'app mostra se la squadra **copre** il lavoro stimato.
- 🫒 **Diario della raccolta**: segna ogni giornata (piante, kg, persone, ore,
  litri d'olio ottenuti) e vedi l'**avanzamento** verso il totale stimato.
- 💾 **Backup**: esporta/importa tutto in **JSON** ed esporta il diario in
  **CSV** (per Excel).
- 📱 **Installabile** come app (PWA) e funzionante anche **offline**.

## 🧮 Come vengono fatte le stime

Sono stime indicative, pensate per pianificare (puoi correggere ogni valore):

- **Olive stimate** = piante × resa media per pianta (kg).
- **Olio stimato (L)** = olive × resa in olio (%) ÷ 0,916 (densità dell'olio).
- **Giornate-persona** = piante ÷ piante raccolte da 1 persona in 1 giorno.
  Le piante/persona al giorno dipendono dal **metodo** (a mano, agevolata,
  mista) e dalle **ore di lavoro** al giorno; nelle *Impostazioni avanzate*
  puoi impostare direttamente il tuo valore.
- **Durata** = giornate-persona ÷ numero di persone della squadra.
- **Persone necessarie** = giornate-persona ÷ giorni a disposizione.

I valori predefiniti (100 piante, 20 kg/pianta, resa 15%, raccolta agevolata,
6 ore/giorno) sono un punto di partenza: adattali alla tua realtà.

## 🚀 Come usarla

### 1. Pubblicala su GitHub Pages (consigliato)

Il workflow incluso (`.github/workflows/deploy.yml`) pubblica il sito a ogni
aggiornamento di `main`.

1. **Una sola volta**, attiva Pages: **Settings → Pages** → alla voce *Build and
   deployment* scegli **Source: "GitHub Actions"**.
2. Riavvia la pubblicazione: **Actions → "Pubblica su GitHub Pages" → Run
   workflow** (oppure fai un nuovo push su `main`).
3. A workflow verde, apri l'indirizzo pubblicato:
   `https://<tuo-utente>.github.io/Biblio/`.

### 2. In locale (per prova)

```bash
python3 -m http.server 8000
```

Poi apri `http://localhost:8000`.

## 🔒 Privacy e dati

- Tutti i dati (piano, materiale, squadra, raccolta) sono salvati **solo nel tuo
  browser** (localStorage). L'app non invia niente ad alcun server.
- Cambiando browser/dispositivo o cancellando i dati del sito perderai tutto:
  usa **Esporta backup** per conservarne una copia.

## 🔐 Sicurezza

L'app è pensata per essere servita in modo sicuro:

- **HTTPS**: pubblicata su GitHub Pages viaggia sempre su HTTPS (attiva anche
  *Settings → Pages → Enforce HTTPS*).
- **Content Security Policy severa**: la pagina consente **solo** risorse dello
  stesso sito e **vieta script e stili inline**, l'esecuzione di codice
  arbitrario (`eval`) e l'incorporamento in `iframe`/oggetti esterni. Poiché
  l'app non usa librerie esterne né chiamate di rete, la policy è molto stretta.
- **Nessun dato in uscita**: i dati restano nel browser (localStorage); non ci
  sono richieste verso server esterni e la policy `referrer` è impostata su
  *no-referrer*.
- **Input trattati in sicurezza**: tutti i testi inseriti vengono "escapati"
  prima di essere mostrati, per evitare iniezioni di codice (XSS).

## 🛠️ Dettagli tecnici

- Sito statico: `HTML` + `CSS` + `JavaScript`, nessun build necessario, nessuna
  dipendenza esterna.
- Tema chiaro/scuro automatico, mobile-first, installabile come PWA.

## 📁 Struttura

```
index.html              Pagina principale (Piano · Materiale · Squadra · Raccolta)
styles.css              Stile (tema uliveto, chiaro/scuro automatico)
app.js                  Logica: calcoli, materiale, squadra, diario, backup
sw.js                   Service worker (offline)
manifest.webmanifest    Configurazione PWA (installazione)
icon.svg                Icona dell'app
.github/workflows/      Pubblicazione automatica su GitHub Pages
```

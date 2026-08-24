# 📚 Biblio — la tua biblioteca di casa

Web app per catalogare i libri di casa: **scansiona il codice a barre** con la
fotocamera del PC o del telefono, l'app **recupera automaticamente i dati** del
libro (titolo, autore, copertina, editore, anno) e ti permette di assegnarlo a
uno **scaffale** scelto da un menù a discesa (o scritto a mano), che viene
**memorizzato** per i successivi inserimenti.

Non serve installare nulla né registrarsi: è un sito statico e tutti i dati
restano **sul tuo dispositivo**.

## ✨ Funzioni

- 📷 **Scansione del codice a barre** (ISBN / EAN-13) dalla fotocamera, con
  torcia e scelta della fotocamera dove disponibili.
- ⌨️ **Inserimento manuale** dell'ISBN come alternativa alla scansione.
- 🔎 **Dati automatici** del libro da *Google Books* e *Open Library*.
- 🗂️ **Scaffali memorizzati**: il menù a discesa propone quelli già usati, ma
  puoi sempre scriverne uno nuovo.
- 📚 **Vista biblioteca** con ricerca (titolo/autore/ISBN), filtro per scaffale,
  ordinamento e raggruppamento per scaffale.
- ✏️ Modifica dello scaffale ed eliminazione direttamente dall'elenco.
- 💾 **Backup**: esporta/importa in **JSON** ed esporta in **CSV** (per Excel).
- 📱 **Installabile** come app (PWA) e funzionante anche **offline** per la
  parte già visitata.

## 🚀 Come usarla

### 1. Pubblicala su GitHub Pages (consigliato)

La fotocamera funziona **solo su HTTPS**: il modo più semplice è pubblicare il
sito su GitHub Pages, che fornisce HTTPS gratuito.

1. Vai su **Settings → Pages** del repository.
2. Alla voce *Build and deployment* scegli **Source: "GitHub Actions"**.
3. Fai il merge di questo ramo nel ramo principale (`main`): il workflow incluso
   (`.github/workflows/deploy.yml`) pubblicherà il sito.
4. Apri l'indirizzo indicato (es. `https://<tuo-utente>.github.io/Biblio/`).

> Puoi anche avviare la pubblicazione manualmente dalla scheda **Actions →
> "Pubblica su GitHub Pages" → Run workflow**.

### 2. In locale (per prova)

Serve un piccolo server web (aprire `index.html` con `file://` non permette la
fotocamera). Per esempio:

```bash
python3 -m http.server 8000
```

Poi apri `http://localhost:8000` (su `localhost` la fotocamera è consentita
anche senza HTTPS). Per usare la fotocamera dal **telefono** ti serve però
l'indirizzo HTTPS di GitHub Pages.

## 📖 Uso quotidiano

1. Apri l'app e premi **▶ Avvia scansione**, concedi il permesso alla
   fotocamera.
2. Inquadra il **codice a barre** sul retro del libro: al riconoscimento senti
   un *bip* e vengono caricati i dati.
3. Controlla/completa i campi, scegli lo **scaffale** dal menù (o scrivine uno
   nuovo) e premi **💾 Salva in biblioteca**.
4. La scansione riparte subito per il libro successivo.
5. Nella scheda **📚 Biblioteca** trovi tutti i libri, con ricerca e filtri.

## 🔒 Privacy e dati

- I dati della biblioteca sono salvati **solo nel tuo browser** (localStorage),
  non vengono inviati a nessun server nostro.
- Per recuperare i dati dei libri, l'ISBN viene inviato ai servizi pubblici
  *Google Books* e *Open Library*.
- Cambiando browser/dispositivo o cancellando i dati del sito perderai la
  biblioteca: usa **Esporta (JSON)** per farne un backup.

## 🛠️ Dettagli tecnici

- Sito statico: `HTML` + `CSS` + `JavaScript`, nessun build necessario.
- Scansione: API nativa **`BarcodeDetector`** dove disponibile (Android/Chrome),
  con fallback a **[ZXing](https://github.com/zxing-js/library)** (caricato da
  CDN) per iPhone/Safari e altri browser.
- Compatibilità: browser recenti su Android, iOS (Safari), Windows, macOS,
  Linux. Su iOS usa **Safari**.

## 📁 Struttura

```
index.html              Pagina principale
styles.css              Stile (tema chiaro/scuro automatico)
app.js                  Logica: scansione, ricerca dati, scaffali, biblioteca
sw.js                   Service worker (offline)
manifest.webmanifest    Configurazione PWA (installazione)
icon.svg                Icona dell'app
.github/workflows/      Pubblicazione automatica su GitHub Pages
```

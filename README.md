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
- ⌨️ **Inserimento manuale** dell'ISBN, oppure **scatta/carica una foto** del
  codice (utile se la webcam del PC non mette a fuoco).
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
sito su GitHub Pages, che fornisce HTTPS gratuito. Il workflow incluso
(`.github/workflows/deploy.yml`) pubblica il sito a ogni aggiornamento di `main`.

1. **Una sola volta**, attiva Pages: **Settings → Pages** → alla voce *Build and
   deployment* scegli **Source: "GitHub Actions"**. (È un passaggio manuale
   perché GitHub non permette al workflow di attivarlo da sé.)
2. Riavvia la pubblicazione: **Actions → "Pubblica su GitHub Pages" → Run
   workflow** (oppure fai un qualsiasi nuovo push su `main`).
3. A workflow verde, apri l'indirizzo pubblicato:
   `https://<tuo-utente>.github.io/Biblio/`.

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

## ❓ Se non riconosce i codici

Sotto l'anteprima compare una riga di **diagnostica** che dice cosa sta leggendo
la fotocamera: usala per capire il problema.

- **Usa il telefono, non la webcam del PC.** Le webcam dei portatili spesso non
  mettono a fuoco le righe sottili del codice: la fotocamera posteriore del
  telefono funziona molto meglio.
- **Distanza e luce:** riempi il riquadro con il codice, tienilo fermo a
  ~15–25 cm, con buona illuminazione (evita riflessi/ombre).
- **Inquadra il codice giusto:** l'**EAN‑13** grande (inizia con **978/979**),
  non il piccolo codice del prezzo accanto.
- Se la diagnostica dice *«Letto … non è un ISBN»*, stai leggendo il codice
  sbagliato; se non dice nulla, è un problema di fuoco/luce.
- **Alternativa sicura:** premi **«Scatta/carica una foto del codice»** e fai
  una foto nitida — spesso funziona anche quando la ripresa dal vivo fatica.
- Su **iPhone** apri il sito con **Safari** e consenti la fotocamera.
- La fotocamera funziona solo su **HTTPS** (o `localhost`): aprendo il file
  `index.html` direttamente (`file://`) non si attiva.

## 🔒 Privacy e dati

- I dati della biblioteca sono salvati **solo nel tuo browser** (localStorage),
  non vengono inviati a nessun server nostro.
- Per recuperare i dati dei libri, l'ISBN viene inviato ai servizi pubblici
  *Google Books* e *Open Library*.
- Cambiando browser/dispositivo o cancellando i dati del sito perderai la
  biblioteca: usa **Esporta (JSON)** per farne un backup.

## 🛠️ Dettagli tecnici

- Sito statico: `HTML` + `CSS` + `JavaScript`, nessun build necessario.
- Scansione: libreria **[ZXing](https://github.com/zxing-js/library)** inclusa
  nel progetto (`vendor/zxing.min.js`, nessuna dipendenza da CDN/internet),
  usata su tutti i browser (iPhone/Safari compresi); se non si carica, ripiega
  sull'API nativa `BarcodeDetector`.
- Compatibilità: browser recenti su Android, iOS (Safari), Windows, macOS,
  Linux. Su iOS usa **Safari**.

## 📁 Struttura

```
index.html              Pagina principale
styles.css              Stile (tema chiaro/scuro automatico)
app.js                  Logica: scansione, ricerca dati, scaffali, biblioteca
vendor/zxing.min.js     Libreria di scansione codici a barre (inclusa)
sw.js                   Service worker (offline)
manifest.webmanifest    Configurazione PWA (installazione)
icon.svg                Icona dell'app
.github/workflows/      Pubblicazione automatica su GitHub Pages
```

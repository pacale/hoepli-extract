# hoepli-extract

Download the pages of a book you are licensed to read on **HoepliAcademy+** and
merge them into a single, searchable, vector PDF with a working table of
contents.

The platform's web reader does not expose a "download the whole book" button:
it serves the book **one page asset at a time** and encrypts the first bytes of
every asset with a key that the web client assembles at runtime. This tool
reuses the session you already have, observes that key while the client is
running, and turns the page assets into a single PDF.

> **Use it only for content you are licensed to access.** The output is for
> personal offline reading. Do not redistribute it, and respect the terms of
> the platform and of the publisher. This project is not affiliated with
> Hoepli, DeA or any other publisher.

---

## Quick start

```bash
git clone https://github.com/pacale/hoepli-extract.git
cd hoepli-extract
npm install
node bin/hoepli.mjs install     # global command + desktop launcher + config
```

Then, in any terminal:

```bash
hoepli                          # pick the book from a list and export it
```

The first run opens a Chrome window on the sign-in page of the platform: sign
in there, the tool waits for the session by itself and continues. The PDF ends
up in `~/Downloads` and opens itself.

| | |
|---|---|
| `hoepli` | interactive menu |
| `hoepli book Java` | export by title (or `hoepli book 4130` by id) |
| `hoepli books` | what is in your account |
| `hoepli info Java` | metadata and page plan, nothing is downloaded |
| `hoepli doctor` | diagnose the environment |
| `hoepli config` | show or change the configuration |

---

## How it works

```
book id ──▶ /api/v6/books/by_book_id/{id}      title, page_count, revision
         ──▶ /api/v5/books/{id}/{revision}/resources   the PDF asset of every page
         ──▶ /api/v5/books/{id}/{revision}/links       the reading order
         ──▶ /api/v5/books/{id}/{revision}/index       the table of contents
                    │
                    ▼
   CDN asset ──▶ [256 B MessagePack] [IV ‖ AES-CBC] [clear tail]
                    │
                    ▼  (key observed from the running client)
              one PDF per page ──▶ merged PDF + outline
```

Nothing is hard-coded per book: the revision, the page list, the reading order
and the table of contents all come from the API, and the decryption key is
captured for the book you are actually reading.

## Requirements

- **Node.js >= 20.6** (uses the built-in `fetch` and `WebSocket`)
- **Google Chrome** — the tool reuses a browser that already exposes a
  DevTools endpoint, otherwise it starts its own instance with a dedicated
  profile in `~/.hoepli-extract/chrome-profile`
- A **HoepliAcademy+ account** that is licensed for the book you want to export

Supported platforms: **Windows, macOS and Linux** (the core is plain Node.js
with no native dependencies; only the installer and the desktop launcher differ
per platform).

## Install

```bash
git clone https://github.com/pacale/hoepli-extract.git
cd hoepli-extract
npm install          # one dependency: pdf-lib
node bin/hoepli.mjs install
```

`install` does three things:

- runs `npm link`, so **`hoepli` is available in every terminal** (if the
  global npm prefix is not writable it falls back to `~/.local/bin` and tells
  you to add it to your `PATH`);
- writes `~/.hoepli-extract/config.json` (default output folder: `~/Downloads`);
- creates a **desktop launcher**:
  - Windows: `Hoepli.lnk`
  - macOS: `Hoepli.command`
  - Linux: `Hoepli.desktop` (GNOME may ask you to allow it: right click →
    *Allow Launching*)

You can also start the menu directly:

- Windows: double click `Avvia-Hoepli.cmd`
- macOS / Linux: `./Avvia-Hoepli.sh` (or `sh Avvia-Hoepli.sh`)

To undo the installation: `hoepli uninstall`.

### Linux notes

- Chrome is looked up in the usual places (`google-chrome`, `chromium`, the
  snap and the flatpak paths). Override it with `HOEPLI_CHROME=/path/to/chrome`.
- On a machine without a display (a server) use `hoepli book <id> --headless`
  or set `display` with Xvfb.
- `xdg-open` is used to open the finished PDF; install `xdg-utils` if it is
  missing.

### macOS notes

- The first launch of Chrome may show the usual Gatekeeper prompt: accept it.
- `open` is used to open the finished PDF.
- The `.command` launcher needs the executable bit, which the repository
  already carries.

## Usage

```bash
hoepli                              # interactive menu: pick a book, export it
hoepli book Java                    # export by title (or by id: hoepli book 4130)
hoepli books                        # what is in your account
hoepli info Java                    # metadata and page plan, nothing downloaded
hoepli config                       # show the configuration
```

The first run opens a Chrome window on the platform sign-in page: sign in
there. The tool waits for the session by itself and continues — no need to
run the command twice. Every later run reuses that session.

The interactive menu looks like this:

```
  I tuoi libri
   1) Java — Claudio De Sio Cesari  [706 pp · ebook]

  Scegli il libro (numero o titolo, vuoto per annullare): 1
  Esporto "Java" (706 pagine) in C:\Users\...\Downloads? [Y/n]

[####################] 100%  706/706  34.9 MB  2.4 MB/s
  706 pagine unite, 33 segnalibri
  aperto: C:\Users\...\Downloads\Java - Claudio De Sio Cesari.pdf
```

The PDF is named `<title> - <author>.pdf` and opened with the system default
viewer when the export finishes.

### Commands

| Command | What it does |
|---|---|
| `hoepli` | interactive menu: list, pick, confirm, export |
| `hoepli book <id\|title>` | export one book |
| `hoepli books [--json]` | the books attached to your account |
| `hoepli info <id\|title> [--json]` | metadata and page plan of one book, nothing is downloaded |
| `hoepli key [--book <id\|title>]` | prints the key the client uses, for debugging |
| `hoepli doctor [--launch]` | environment diagnostics (Chrome, DevTools port, session, network, pdf-lib) |
| `hoepli install` / `hoepli uninstall` | global command, desktop shortcut, configuration |
| `hoepli config [key [value]]` | show or change the configuration |

A book can be selected by id or by title; titles are matched exactly, then by
prefix, then by fragment, then by similarity, and an ambiguous match opens the
menu.

### Options

```
--out <file>        output PDF (default: <outputDir>/<title> - <author>.pdf)
--out-dir <dir>     output folder (default: ~/Downloads)
--pages <a-b>       export only that range of pages
--concurrency <n>   parallel asset downloads (default 6)
--aes-key <base64>  use this key instead of capturing it at runtime
--cookie <string>   session cookie (otherwise read from the browser)
--token <string>    AUTH_TOKEN (otherwise read from the account)
--port <n>          DevTools port to use (default 9222)
--headless          start the dedicated browser without a window (servers)
--keep-browser      do not close the browser the tool started
--open / --no-open  open the PDF when the export finishes
--yes               do not ask for confirmation
--no-toc            do not build the outline
--no-merge          keep the single page files, skip merging
--keep-pages        keep the single page files next to the output
--strict            fail if any page is missing
--json              machine readable output
--report <file>     write the JSON report
--log-level <lvl>   debug | info | warn | error | silent
```

### Configuration

`~/.hoepli-extract/config.json`:

| key | default | meaning |
|---|---|---|
| `outputDir` | `~/Downloads` | where the PDFs are written |
| `concurrency` | `6` | parallel asset downloads |
| `openAfter` | `true` | open the PDF when the export finishes |
| `port` | `9222` | DevTools port used for the session |
| `waitLoginSec` | `600` | how long to wait for the sign-in |

Change it with `hoepli config set outputDir "D:\Books"` (the `set` keyword is
optional) and read it back with `hoepli config`.

## Stability

The tool is built to survive a flaky network and a platform that changes under
its feet:

- every page is checked against the **MD5 the platform publishes** before it
  is written to disk: a corrupted download is rejected, retried and reported,
  and can never end up in the PDF;
- a page file that cannot be read is skipped instead of throwing away the
  whole merge;
- the finished PDF is compared with the `page_count` the platform announces,
  so a book with missing pages is never reported as "OK";
- every API call has a 30 s timeout and one retry with jittered backoff;
- the pages that fail are retried in a second, gentler pass;
- an expired session is refreshed and the run continues;
- a full disk aborts immediately with a clear message instead of failing 706
  times;
- two runs on the same book are serialised by a lock file;
- the browser the tool started for itself is closed at the end of the export
  (that frees about 630 MB of RAM; the session stays in the profile). Use
  `--keep-browser` to leave it open.

`hoepli doctor` checks all of this, and with a valid session it also verifies
the **whole export chain** (session → key → decryption of a real page → MD5) in
about 15 seconds, so you know before starting a long export whether it will
work. `--quick` skips that part.

The measurements are in [`docs/performance.md`](docs/performance.md).

## Troubleshooting

| Symptom | What it means and what to do |
|---|---|
| `the browser session is not signed in` | the Chrome instance has no valid session. The tool opens the sign-in page: sign in there. Without an interactive terminal, pass `--cookie` and `--token` by hand. |
| `no decryption key observed` | the reader did not decrypt anything. Usually the account is not licensed for that book, or the book is published as *liquid text* (no PDF at all). Check with `hoepli info <book>`. |
| `none of the observed keys decrypts the page assets` | the platform changed the asset format. The tool stops instead of writing a broken PDF. |
| `cached page N does not match the published md5` | a cached file is damaged: it is deleted and downloaded again automatically. |
| `N page(s) failed` | some pages could not be fetched. The report lists them with the reason; the PDF is still produced with the pages that worked, and the exit code is `2`. |
| `npm link failed` | the global npm prefix is not writable: the tool installs the command in `~/.local/bin` and prints the `PATH` line to add. |
| the launcher does nothing on GNOME | right click the `.desktop` file and choose *Allow Launching*. |
| the PDF does not open | `xdg-open` is missing on Linux (`apt install xdg-utils`); use `--no-open` and open the file manually. |

## Environment variables

| Variable | Meaning |
|---|---|
| `HOEPLI_AES_KEY` | default AES key (base64) |
| `HOEPLI_COOKIE` | default session cookie |
| `HOEPLI_TOKEN` | default `AUTH_TOKEN` |
| `HOEPLI_CHROME` | Chrome executable to use |
| `HOEPLI_HOME` | state directory, default `~/.hoepli-extract` |
| `HOEPLI_LOG_LEVEL` | `debug` shows every request and retry |

## Exit codes

| Code | Meaning |
|---|---|
| `0` | everything was exported and verified |
| `2` | partial: some pages are missing, or the output has warnings |
| `1` | fatal error (no session, unsupported book, network failure) |

The JSON report (`--report`) contains the page counts, the integrity checks
and the list of failures. It never contains cookies, tokens, e-mail addresses
or the decryption key.

## Verification

Every page is checked three times while it is downloaded:

1. the decrypted bytes start with `%PDF-` and end with `%%EOF`
2. the size matches `orig_size` from the asset header
3. the MD5 of the decrypted page matches the `md5` the platform publishes for
   that asset

After the merge the tool re-opens the result, checks the page count against
the number of downloaded pages, checks the outline and samples the content
streams.

## Privacy

- The tool never stores your session: the cookie is read from the browser at
  run time and the `AUTH_TOKEN` is re-read from the account on every run.
- Log output and reports redact cookies, tokens and e-mail addresses.
- The decryption key is never written to disk and is not part of the source.
- The repository contains **no book content**; the test fixtures are
  synthetic PDFs generated by the test-suite itself.

## Tests

```bash
npm test        # unit tests, no network, no credentials
```

The end-to-end test needs a signed-in session and is documented in
[`test/e2e/README.md`](test/e2e/README.md).

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — the asset container format,
  the API map and the crypto flow
- [`docs/performance.md`](docs/performance.md) — how the tool is measured, and
  what the stability work changed

## Guida in italiano

Il tool scarica le pagine di un libro che sei autorizzato a leggere su
HoepliAcademy+ e le unisce in **un unico PDF vettoriale** con testo
selezionabile e indice interattivo. Funziona su **Windows, macOS e Linux**.

### 1. Installazione (una volta sola)

```bash
git clone https://github.com/pacale/hoepli-extract.git
cd hoepli-extract
npm install
node bin/hoepli.mjs install
```

`install` fa tre cose:

- rende il comando **`hoepli`** disponibile in qualsiasi terminale (col link
  globale npm; se il prefix globale non è scrivibile va in `~/.local/bin` e il
  tool ti dice cosa mettere nel `PATH`);
- scrive la configurazione in `~/.hoepli-extract/config.json`;
- crea un **launcher sul desktop**: `Hoepli.lnk` (Windows), `Hoepli.command`
  (macOS), `Hoepli.desktop` (Linux).

In alternativa puoi lanciare il menu direttamente: doppio click su
`Avvia-Hoepli.cmd` (Windows) o `./Avvia-Hoepli.sh` (macOS/Linux).

Per disinstallare: `hoepli uninstall`.

### 2. Uso quotidiano

```bash
hoepli                  # menù: scegli il libro dalla lista, conferma, esporta
hoepli book Java        # oppure per titolo (o hoepli book 4130 per id)
hoepli books            # cosa c'è nella tua libreria
hoepli info Java        # metadati e piano di estrazione, non scarica nulla
```

Al primo avvio si apre una finestra di Chrome con il **login di
HoepliAcademy+**: accedi lì e il tool **aspetta da solo** la sessione e
prosegue (non devi rilanciare il comando). Nei run successivi la sessione
viene riutilizzata.

Il PDF viene scritto in `~/Downloads` con il nome `<titolo> - <autore>.pdf` e
**aperto automaticamente** alla fine. La cartella si cambia con:

```bash
hoepli config set outputDir "D:\Libri"
```

### 3. Comandi

| Comando | Cosa fa |
|---|---|
| `hoepli` | menù interattivo: elenco, scelta, conferma, export |
| `hoepli book <id\|titolo>` | esporta un libro |
| `hoepli books [--json]` | i libri del tuo account |
| `hoepli info <id\|titolo> [--json]` | metadati e piano di estrazione |
| `hoepli key [--book <id\|titolo>]` | mostra la chiave usata dal client (debug) |
| `hoepli doctor [--launch]` | diagnostica dell'ambiente |
| `hoepli install` / `hoepli uninstall` | comando globale, launcher, configurazione |
| `hoepli config [chiave [valore]]` | mostra o modifica la configurazione |

Un libro si sceglie per id o per titolo: il titolo viene cercato esattamente,
poi per inizio, poi per frammento, poi per somiglianza; se i match sono più di
uno si apre il menu.

### 4. Opzioni utili

```
--out <file>        file di output specifico
--out-dir <dir>     cartella di output
--pages <a-b>       esporta solo un intervallo di pagine
--concurrency <n>   pagine scaricate in parallelo (default 6)
--aes-key <base64>  usa una chiave invece di catturarla a runtime
--cookie/--token    sessione manuale, senza browser
--port <n>          porta DevTools (default 9222)
--headless          browser senza finestra (server)
--keep-browser      non chiudere il browser avviato dal tool
--open/--no-open    apre o non apre il PDF alla fine
--yes               non chiede conferme
--keep-pages        conserva le pagine singole
--strict            fallisce se manca una pagina
--report <file>     salva il report JSON
--log-level <lvl>   debug | info | warn | error | silent
```

### 5. Se qualcosa non va

- **`the browser session is not signed in`** → accedi nella finestra di Chrome
  che si apre; senza terminale interattivo passa `--cookie` e `--token`.
- **`no decryption key observed`** → l'account non è abilitato a quel libro,
  oppure il libro è in "testo liquido" e non ha PDF (`hoepli info <libro>`).
- **`N page(s) failed`** → alcune pagine non sono scaricabili; il report
  elenca i motivi e il PDF viene comunque prodotto (exit code 2).
- **su Linux** il `.desktop` va autorizzato una volta (click destro →
  *Consenti l'esecuzione*); per aprire il PDF serve `xdg-utils`.
- **su un server senza schermo**: `hoepli book <id> --headless`.

Il file prodotto viene verificato pagina per pagina: header PDF, dimensione
attesa dal server e **MD5 confrontato con quello pubblicato dalla
piattaforma**.

## License

MIT — see [LICENSE](LICENSE). The tool is provided as is, without any warranty.

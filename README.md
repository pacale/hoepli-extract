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
| `hoepli key [--book <id>]` | prints the key the client uses, for debugging |
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

Change it with `hoepli config set outputDir "D:\Books"`.

### Environment variables

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

## Note in italiano

Il comando si installa una volta sola:

```bash
git clone https://github.com/pacale/hoepli-extract.git
cd hoepli-extract
npm install
node bin/hoepli.mjs install
```

Da quel momento **`hoepli`** funziona da qualunque cartella e c'è anche un
**collegamento sul desktop**. Il flusso tipico è:

```bash
hoepli                  # menù: scegli il libro dalla lista
hoepli book Java        # oppure per titolo
```

Al primo avvio si apre una finestra di Chrome con il login di HoepliAcademy+:
**accedi lì** e il tool aspetta da solo la sessione e prosegue (non devi
rilanciare il comando). Il PDF viene scritto in `~/Downloads` con il nome
`<titolo> - <autore>.pdf` e aperto automaticamente. La cartella di destinazione
si cambia con `hoepli config set outputDir "D:\Libri"`.

Su Windows si può anche fare doppio click su **`Avvia-Hoepli.cmd`**, su
macOS e Linux con **`./Avvia-Hoepli.sh`**.

Il tool funziona su **Windows, macOS e Linux**: il nucleo è Node.js puro
(senza dipendenze native), cambia solo l'installer e il launcher sul desktop
(`.lnk` su Windows, `.command` su macOS, `.desktop` su Linux). Su un server
senza schermo si usa `hoepli book <id> --headless`.

## License

MIT — see [LICENSE](LICENSE). The tool is provided as is, without any warranty.

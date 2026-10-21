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

## Install

```bash
npm install          # one dependency: pdf-lib
```

## Usage

```bash
# 0. check the environment
node bin/hoepli.mjs doctor --launch

# 1. list the books of your account
node bin/hoepli.mjs books

# 2. inspect a book without downloading anything
node bin/hoepli.mjs info 4130

# 3. export it
node bin/hoepli.mjs book 4130 --out "Java.pdf"
```

The first run opens a Chrome window on the platform sign-in page. Sign in
there; every later run reuses that session.

### Commands

| Command | What it does |
|---|---|
| `hoepli doctor [--launch]` | environment diagnostics (Chrome, DevTools port, session, network, pdf-lib) |
| `hoepli books [--json]` | the books attached to your account |
| `hoepli info <bookId> [--json]` | metadata and page plan of one book, nothing is downloaded |
| `hoepli key [--book <bookId>]` | prints the key the client uses, for debugging |
| `hoepli book <bookId> --out <file.pdf>` | download, decrypt, merge, verify |

### Options

```
--out <file>        output PDF (default ./<title>-<id>.pdf)
--pages <a-b>       export only that range of pages
--concurrency <n>   parallel asset downloads (default 6)
--aes-key <base64>  use this key instead of capturing it at runtime
--cookie <string>   session cookie (otherwise read from the browser)
--token <string>    AUTH_TOKEN (otherwise read from the account)
--port <n>          DevTools port to use (default 9222)
--no-toc            do not build the outline
--no-merge          keep the single page files, skip merging
--keep-pages        keep the single page files next to the output
--strict            fail if any page is missing
--json              machine readable output
--report <file>     write the JSON report
--log-level <lvl>   debug | info | warn | error | silent
```

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

## License

MIT — see [LICENSE](LICENSE). The tool is provided as is, without any warranty.

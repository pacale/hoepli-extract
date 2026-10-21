# Architecture

How the platform serves a book, and what this tool does about it. Everything
here was derived from the public behaviour of the web client and from the
responses of the (authenticated) API; no page content is reproduced.

## 1. The web client

`my.hoepliacademy.it` is an Angular single page application:

- `scripts/<hash>.min.js` — the application bundle (browserify)
- `vendor/pdfjs-dist/` — PDF.js, used by the reader
- `styles/<hash>.min.css`

The reader renders **one PDF per page**, not a single document. The page
assets are listed by the API and fetched from a CDN as they are needed.

## 2. The API

All endpoints live on `https://www.hoepliacademy.it`.

| Endpoint | Purpose |
|---|---|
| `GET /api/v6/user` | the current user and the `auth_token` |
| `GET /api/v6/books?page_thumb_size=medium&per_page=25000` | the books of the account |
| `GET /api/v6/books/by_book_id/{id}` | metadata: title, authors, `page_count`, `current_edition.revision`, `liquid_text` |
| `GET /api/v5/books/{id}` | the revision of a book |
| `GET /api/v5/books/{id}/{revision}/resources` | the resources of a book, each with its assets |
| `GET /api/v5/books/{id}/{revision}/links` | the reading order (`order` per page resource) |
| `GET /api/v5/books/{id}/{revision}/index` | the table of contents (units with `first_page`/`last_page`) |

**Authentication** has two layers:

- a session cookie (`_bsw_session_v1_production`, `remember_user_token`), sent
  by the browser;
- an `AUTH_TOKEN` header, whose value is the `auth_token` field returned by
  `/api/v6/user`. The token rotates, so it is always re-read instead of
  being stored.

The second path segment of the `/api/v5/books/...` URLs is the **revision**,
not a chapter or a unit: the client calls `getBookRevision()` and then uses
that value for resources, links and index.

## 3. Resources and assets

A resource is one page of the book. Resource types seen in the wild:

| `resource_type_id` | meaning |
|---|---|
| `12` | the book itself |
| `14` | a page |
| `27` | a downloadable part |

An asset is a file attached to a resource. The relevant `use` values are
`page_pdf` (the page itself), `page_thumb_medium` / `page_thumb_small`
(preview images) and `cover_medium` / `cover_small`.

A page asset looks like this:

```json
{
  "id": 757649,
  "filename": "pagine/HOE25A_302P_C01.pdf",
  "use": "page_pdf",
  "md5": "12ac9b90223bf45eaf35bbd8e2e30394",
  "size": 88004,
  "url": "https://wl-hoepliacademy.bsmart.it/production/pub-hoepliacademy/1/2/12ac9b90223bf45eaf35bbd8e2e30394"
}
```

The CDN path is derived from the MD5 of the asset, and the assets themselves
are served without authentication.

## 4. The asset container

A downloaded asset is **not** a PDF. It is a container:

```
offset 0                     256                    start                EOF
+---------------------------+-----------------------+---------------------+
| MessagePack meta (padded) | IV (16 B) ‖ AES-CBC   | clear-text tail     |
+---------------------------+-----------------------+---------------------+
```

The MessagePack map holds the metadata the client needs:

| field | meaning |
|---|---|
| `filename` | original file name, e.g. `pagine/HOE25A_302P_C01.pdf` |
| `md5` | MD5 of the decrypted page |
| `orig_size` | size of the decrypted page |
| `start` | offset where the encrypted segment ends |
| `path` | logical folder (`pagine`, `indici`, …) |

The client decrypts the segment between offset 256 and `start` and appends the
clear tail, which restores the original PDF byte for byte:

```js
plain = AES_CBC.decrypt(segment).subarray(16)   // .subarray(16) drops the IV
pdf   = plain + tail
```

The key is a base64 string that the client converts with `base64ToUint8`
(therefore `atob`). It is **assembled at runtime** by obfuscated client code
and is not present as a literal in the bundle, so it cannot be extracted
statically — it has to be observed while the client runs.

## 5. Capturing the key

`hoepli-extract` hooks `window.atob` in the reader page before the
application boots (`Page.addScriptToEvaluateOnNewDocument`) and records every
base64 string that decodes to 16, 24 or 32 bytes — the typical AES key
lengths.

Recording candidates is not enough: unrelated strings of the same length
would also be recorded. Every candidate is therefore **validated** against a
real page asset: it is accepted only when it actually turns an encrypted
container back into a PDF. This makes the capture robust and it also works
when the platform uses a different key for a different book or publisher.

## 6. Merging and the outline

The decrypted pages are ordinary one-page PDFs. They are merged with
`pdf-lib` (MIT) and the table of contents is built from the `/index` endpoint:
every unit provides a `first_page` resource id, which is mapped to a page
number through the reading order of `/links`.

`pdf-lib` has no high-level bookmark API, so the outline is assembled with the
low-level PDF object API: an `/Outlines` dictionary, one item per unit, linked
as a doubly linked list and nested by level (parts on level 1, chapters and
summaries on level 2).

## 7. Known variations

The tool detects and reports the cases it cannot handle perfectly:

- **`liquid_text: true`** — the book is published as flowing text, there are no
  PDF assets to export.
- **Teacher pages** — some units report `leaves_counter.teacher > 0`. Those
  pages are only visible to a teacher account, so the export contains exactly
  the edition the signed-in account is licensed for.
- **Monolithic books** — some books are served as a single PDF asset instead
  of one asset per page; the tool falls back to exporting that file as is.
- **Unsupported key** — if no observed candidate decrypts the assets, the tool
  stops with a clear error instead of producing a broken PDF.

# End-to-end test

The unit tests run without a session. The end-to-end test needs a signed-in
HoepliAcademy+ session, so it is **not** part of the CI workflow.

## Procedure

1. Make sure a browser with a DevTools endpoint is available:

   ```bash
   node bin/hoepli.mjs doctor --launch
   ```

   The first run opens a dedicated Chrome window on the sign-in page. Sign in
   there; the profile in `~/.hoepli-extract/chrome-profile` keeps the session
   for later runs.

2. Export the book and compare the result:

   ```bash
   node bin/hoepli.mjs book <bookId> --out /tmp/book.pdf --keep-pages --report /tmp/report.json
   ```

3. Check the report:

   - `download.md5_verified` equals `download.files` (every page matches the
     MD5 published by the platform)
   - `manifest.pages` equals `book.page_count`
   - `verification.pages` equals `manifest.pages`
   - `verification.outline` equals `manifest.toc_entries`

4. Spot-check the output by rendering a few pages (cover, index, a text page,
   a code page) and confirm that the text layer is present.

## Scripted variant

`test/e2e/run-e2e.mjs` performs the same steps and exits non-zero when the
checks do not match:

```bash
node test/e2e/run-e2e.mjs --book <bookId> --out /tmp/book.pdf
```

It needs the same session as the CLI and never stores credentials.

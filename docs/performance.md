# Stability and performance

This page documents what the tool measures, how the numbers were obtained and
what changed when the stability work landed. Everything here is reproducible
with the commands shown.

## The benchmark

`test/bench/bench.mjs` runs the export pipeline (the same functions the CLI
uses) with instrumentation:

- **time per phase**: session, key capture, download, merge, verification;
- **peak RSS** of the Node process (sampled every 150 ms);
- **RAM of the browser** the tool uses, before and after the run;
- **HTTP requests**, **bytes downloaded**, **bytes written**;
- the size of the produced PDF and of the cache left behind.

```bash
node test/bench/bench.mjs --pages 150 --runs 3 --out results.json --label my-label
```

Conditions used for the comparison below: the same book (id 4130), the first
150 pages, a clean cache before every run, concurrency 6, three runs each and
the **median** of the three.

## Before and after the stability work

Commit `6d84334` (v0.3.1) versus the stability branch, same harness, same
conditions:

| Metric | before | after | delta |
|---|---|---|---|
| total time | 15.8 s | **15.0 s** | -5 % |
| ... key capture | 3.6 s | 2.9 s | -19 % |
| ... download | 2.4 s | 2.5 s | +4 % |
| ... merge | 3.3 s | 3.2 s | -3 % |
| ... verification | 3.8 s | 3.8 s | = |
| ... API calls | 2.7 s | 2.5 s | -7 % |
| peak RSS of the Node process | 259.5 MB | **253.8 MB** | -2 % |
| HTTP requests | 169 | 165 | -2 % |
| bytes downloaded | 9.25 MB | 9.25 MB | = |
| PDF produced | 7.67 MB | 7.67 MB | = |
| cache left behind | 8 MB | 8 MB | = |
| pages verified (MD5) | 150/150 | 150/150 | = |
| single run times | 15.8 / 15.8 / **46.3** s | 15.1 / 14.8 / 15.0 s | no outliers |

**Conclusion: the stability work did not make the tool slower.** The happy
path is within the noise of the previous version and slightly better; the
variance is smaller (the 46 s outlier of the old version is gone, it was a
CDN hiccup that the new retry logic absorbs).

## What the stability work really buys

| Situation | before | after |
|---|---|---|
| a page arrives corrupted | it was written and merged **silently** | it is rejected, retried and reported |
| a page file is unreadable | the whole 35 MB merge was lost | the page is skipped, the other 705 are merged |
| some pages are missing | the verification said "OK" | the PDF is compared with the `page_count` the platform publishes |
| the API hangs | the tool waited **forever** | 30 s timeout, one retry, clear message |
| the session expires | the export died | the token is refreshed and the run continues |
| the disk is full | 706 identical errors | immediate, explicit abort |
| two runs at the same time | they corrupted the shared cache | a lock file serialises them |
| the browser started by the tool | it stayed alive for ever | it is closed at the end, **~630 MB of RAM freed** |

### The RAM point, measured

The dedicated Chrome instance of the tool holds about **630 MB** across 9
processes while the reader is open:

```
RAM Chrome del tool prima:  628.1 MB
RAM Chrome del tool dopo:     0.0 MB     (il tool lo chiude a fine export)
processi chrome del tool:    0
```

The session survives the browser being closed: it lives in the profile
(`~/.hoepli-extract/chrome-profile`), so the next run reopens the browser and
is still signed in. Use `--keep-browser` to leave it open.

## Footprint

| | v0.3.1 | now |
|---|---|---|
| source files | 19 | 20 |
| lines of code | 2.319 | 2.784 |
| bytes of source | 87,7 KB | 105,0 KB |
| test files / lines | 12 / 537 | 14 / 840 |
| runtime dependencies | 1 (`pdf-lib`) | 1 (`pdf-lib`) |
| `node_modules` | 20,8 MB | 20,8 MB |
| state on disk | 137 MB (all Chrome profile) | 184 MB (Chrome profile) + 0 MB page cache |

The page cache is removed at the end of every export; only the Chrome profile
stays (it holds the session). The tool keeps the caches of the last three
books and drops the older ones.

## Honest notes

- The extra checks cost almost nothing in the happy path: verifying the MD5 of
  the pages that are resumed from the cache costs about 1 s on 706 pages.
- Closing the browser makes the *next* run about 1-2 s slower (it has to
  start it again). That is the price for not leaving 630 MB allocated.
- The download speed is limited by the CDN, not by the tool: 150 pages in
  2.5 s with concurrency 6.

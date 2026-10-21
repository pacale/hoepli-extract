// Progress reporting for long running steps.
//
// On an interactive terminal a single line is rewritten in place; in a pipe or
// a log file the progress is printed as periodic plain lines instead.

export function formatProgress({ done, total, bytes, rate, elapsedMs }) {
  const percent = total ? Math.floor((done / total) * 100) : 0;
  const width = 20;
  const filled = Math.round((percent / 100) * width);
  const bar = `${'#'.repeat(filled)}${'.'.repeat(width - filled)}`;
  const mb = (bytes / 1048576).toFixed(1);
  const parts = [`[${bar}] ${String(percent).padStart(3)}%`, `${done}/${total}`, `${mb} MB`];
  if (rate) parts.push(`${(rate / 1048576).toFixed(1)} MB/s`);
  if (elapsedMs && total && done < total) {
    const eta = Math.round((elapsedMs / done) * (total - done) / 1000);
    parts.push(`ETA ${eta}s`);
  }
  return parts.join('  ');
}

export function createProgress({ total, label = 'working', stream = process.stdout, enabled = true } = {}) {
  const interactive = Boolean(stream.isTTY);
  let last = 0;
  let started = Date.now();
  let bytes = 0;

  const write = (line) => {
    if (!enabled) return;
    if (interactive) stream.write(`\r${line.padEnd(100)}`);
    else stream.write(`${line}\n`);
  };

  return {
    start() {
      started = Date.now();
      this.update(0, 0);
    },
    /** @param done items finished @param totalBytes absolute number of bytes handled so far */
    update(done, totalBytes = bytes) {
      bytes = Number(totalBytes) || 0;
      const now = Date.now();
      const elapsed = now - started;
      const rate = done > 0 ? (bytes / elapsed) * 1000 : 0;
      if (interactive) {
        write(formatProgress({ done, total, bytes, rate, elapsedMs: elapsed }));
        last = now;
        return;
      }
      if (done === total || now - last > 3000) {
        write(formatProgress({ done, total, bytes, rate, elapsedMs: elapsed }));
        last = now;
      }
    },
    stop(summary) {
      if (!enabled) return;
      if (interactive) stream.write('\r');
      if (summary) console.log(`  ${summary}`);
    },
  };
}

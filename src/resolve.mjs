// Find a book in the user's library by id or by title.

function normalise(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function levenshtein(a, b) {
  const s = normalise(a);
  const t = normalise(b);
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  let prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i++) {
    const row = [i];
    for (let j = 1; j <= t.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1)
      );
    }
    prev = row;
  }
  return prev[t.length];
}

function scoreTitle(book, query) {
  const title = normalise(book.title);
  const subtitle = normalise(book.subtitle);
  const author = normalise(book.author);
  const q = normalise(query);
  if (!q) return 0;
  if (title === q || subtitle === q) return 100;
  if (title.startsWith(q) || subtitle.startsWith(q)) return 80;
  if (title.includes(q) || subtitle.includes(q) || author.includes(q)) return 60;
  const distance = Math.min(
    levenshtein(title, q),
    subtitle ? levenshtein(subtitle, q) : Number.MAX_SAFE_INTEGER
  );
  const threshold = Math.max(2, Math.min(4, Math.round(q.length / 3)));
  if (distance <= threshold) return 40 - distance;
  return 0;
}

/**
 * Resolve a query against the library.
 * @returns {{kind:'exact'|'ambiguous'|'none', book?:object, books:object[]}}
 */
export function resolveBook(books, query) {
  const list = books || [];
  const text = String(query ?? '').trim();
  if (!text) return { kind: 'none', books: [] };

  if (/^\d+$/.test(text)) {
    const byId = list.find((b) => String(b.id) === text);
    if (byId) return { kind: 'exact', book: byId, books: [byId] };
  }

  const scored = list
    .map((book) => ({ book, score: scoreTitle(book, text) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return { kind: 'none', books: [] };
  const best = scored[0].score;
  const winners = scored.filter((entry) => entry.score === best).map((entry) => entry.book);
  if (winners.length === 1) return { kind: 'exact', book: winners[0], books: winners };
  return { kind: 'ambiguous', books: winners };
}

/** The books whose title is closest to the query, for error messages. */
export function closestTitles(books, query, limit = 5) {
  return (books || [])
    .map((book) => ({ book, distance: levenshtein(book.title, query) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map((entry) => entry.book.title);
}

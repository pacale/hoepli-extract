// Terminal interaction: picking a book, asking yes/no, opening a file.
//
// Everything degrades gracefully when there is no interactive terminal, so the
// tool never blocks on stdin in a script or in a pipeline.

import { spawn } from 'node:child_process';
import readline from 'node:readline/promises';

// process.stdin / process.stdout are read at call time on purpose: the
// interactive helpers can then be driven by a scripted terminal in the tests.
let interactiveOverride = null;

/** Force the interactive mode on or off (used by the tests). */
export function setInteractive(value) {
  interactiveOverride = value;
}

export function isInteractive() {
  if (interactiveOverride !== null) return interactiveOverride;
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/** Words that mean "stop, do nothing". */
const CANCEL_WORDS = new Set([
  'nulla',
  'niente',
  'n',
  'no',
  'ne',
  'esci',
  'exit',
  'quit',
  'q',
  'annulla',
  'cancel',
  'abbandona',
]);

export function isCancel(text) {
  const value = String(text ?? '').trim().toLowerCase();
  if (!value) return true;
  return CANCEL_WORDS.has(value);
}

function createInterface() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

/** Ask one question on the terminal and return the trimmed answer. */
export async function askOnTerminal(question) {
  const rl = createInterface();
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export async function confirm(question, { defaultYes = true, ask = askOnTerminal } = {}) {
  if (!isInteractive()) return defaultYes;
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  const answer = (await ask(`${question} ${hint} `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  if (isCancel(answer)) return false;
  return answer === 'y' || answer === 's' || answer === 'si' || answer === 'yes';
}

export function formatBookLine(book, index) {
  const pages = book.page_count ? `${book.page_count} pp` : '?';
  const kind = book.typology || '?';
  const author = book.author ? ` — ${book.author}` : '';
  return `  ${String(index + 1).padStart(2)}) ${book.title}${author}  [${pages} · ${kind}]`;
}

/**
 * Ask the user to choose one book.
 * @returns {Promise<object|null>} null when the user cancels
 */
export async function pickBook(
  books,
  { title = 'I tuoi libri', emptyMessage = 'nessun libro trovato', ask = askOnTerminal } = {}
) {
  if (!books || !books.length) {
    console.log(`  ${emptyMessage}`);
    return null;
  }
  if (!isInteractive()) {
    console.log('  (nessun terminale interattivo: indicare il libro con "hoepli book <id>")');
    return null;
  }
  console.log('');
  console.log(`  ${title}`);
  books.forEach((book, i) => console.log(formatBookLine(book, i)));
  console.log('');
  while (true) {
    const answer = (await ask('  Scegli il libro (numero o titolo, vuoto o "nulla" per annullare): ')).trim();
    if (isCancel(answer)) return null;
    if (/^\d+$/.test(answer)) {
      const book = books[Number(answer) - 1];
      if (book) return book;
      console.log('  quel numero non corrisponde a un libro');
      continue;
    }
    const needle = answer.toLowerCase();
    const hits = books.filter((b) => (b.title || '').toLowerCase().includes(needle));
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) {
      console.log('  più libri corrispondono:');
      hits.forEach((book, i) => console.log(formatBookLine(book, i)));
      continue;
    }
    console.log('  nessun libro corrisponde, riprova (vuoto o "nulla" per annullare)');
  }
}

/** The command used to open a file with the system default application. */
export function openCommandFor(platform = process.platform) {
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', ''] };
  if (platform === 'darwin') return { command: 'open', args: [] };
  return { command: 'xdg-open', args: [] };
}

/** Open a file with the system default application; never throws. */
export async function openFile(file) {
  const { command, args } = openCommandFor();
  return new Promise((resolve) => {
    try {
      const child = spawn(command, [...args, file], { detached: true, stdio: 'ignore' });
      child.on('error', () => resolve(false));
      child.unref();
      resolve(true);
    } catch {
      resolve(false);
    }
  });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  launcherName,
  launcherPath,
  macosLauncherScript,
  linuxDesktopEntry,
  posixLauncherScript,
  localBinDir,
  binPath,
  repoRoot,
} from '../../src/install.mjs';

test('names the desktop launcher per platform', () => {
  assert.equal(launcherName('win32'), 'Hoepli.lnk');
  assert.equal(launcherName('darwin'), 'Hoepli.command');
  assert.equal(launcherName('linux'), 'Hoepli.desktop');
});

test('puts the launcher on the desktop', () => {
  assert.match(launcherPath('linux'), /Desktop[/\\]Hoepli\.desktop$/);
  assert.match(launcherPath('darwin'), /Desktop[/\\]Hoepli\.command$/);
});

test('the macOS launcher runs the tool in a terminal', () => {
  const script = macosLauncherScript();
  assert.match(script, /^#!\/bin\/bash/);
  assert.match(script, /bin[/\\]hoepli\.mjs/);
  assert.match(script, /exec /);
});

test('the Linux desktop entry is a valid terminal launcher', () => {
  const entry = linuxDesktopEntry();
  assert.match(entry, /^\[Desktop Entry\]/);
  assert.match(entry, /Type=Application/);
  assert.match(entry, /Terminal=true/);
  assert.match(entry, /Name=Hoepli/);
  assert.match(entry, /Exec="[^"]+" ".*hoepli\.mjs"/);
});

test('the POSIX launcher forwards its arguments', () => {
  const script = posixLauncherScript();
  assert.match(script, /^#!\/bin\/sh/);
  assert.match(script, /"\$@"/);
});

test('the local command lives in ~/.local/bin on unix', () => {
  assert.match(localBinDir('linux'), /\.local[/\\]bin$/);
  assert.match(localBinDir('darwin'), /\.local[/\\]bin$/);
});

test('the bin path points inside the repository', () => {
  assert.match(binPath(), /hoepli-extract[/\\]bin[/\\]hoepli\.mjs$/);
  assert.match(repoRoot(), /hoepli-extract$/);
});

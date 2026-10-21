// "hoepli install": make the command available everywhere, remember the
// preferences and put a shortcut on the desktop.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { log, homeDir, ensureDir } from './util.mjs';
import { saveConfig, configPath, loadConfig } from './config.mjs';

export function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

export function binPath() {
  return path.join(repoRoot(), 'bin', 'hoepli.mjs');
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

export function desktopDir() {
  if (process.platform === 'win32') {
    const userProfile = process.env.USERPROFILE || os.homedir();
    return path.join(userProfile, 'Desktop');
  }
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Desktop');
  const xdg = process.env.XDG_DESKTOP_DIR;
  return xdg || path.join(os.homedir(), 'Desktop');
}

function shortcutPath() {
  return path.join(desktopDir(), 'Hoepli.lnk');
}

/** Create the desktop shortcut; returns false when it could not be created. */
export function createShortcut() {
  if (process.platform !== 'win32') return false;
  const script = path.join(ensureDir(homeDir()), 'create-shortcut.ps1');
  const target = process.execPath;
  const args = `"${binPath()}"`;
  const working = repoRoot();
  const link = shortcutPath();
  fs.writeFileSync(
    script,
    [
      '$ErrorActionPreference = "Stop"',
      '$ws = New-Object -ComObject WScript.Shell',
      `$s = $ws.CreateShortcut('${link.replace(/'/g, "''")}')`,
      `$s.TargetPath = '${target.replace(/'/g, "''")}'`,
      `$s.Arguments = '${args.replace(/'/g, "''")}'`,
      `$s.WorkingDirectory = '${working.replace(/'/g, "''")}'`,
      '$s.Description = "Hoepli - export the books you are licensed to read"',
      '$s.Save()',
      'Write-Output "OK"',
    ].join('\r\n')
  );
  try {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
      { encoding: 'utf8' }
    );
    return out.includes('OK');
  } catch (e) {
    log.debug(`shortcut creation failed: ${e.message}`);
    return false;
  }
}

export function removeShortcut() {
  const link = shortcutPath();
  try {
    if (fs.existsSync(link)) fs.rmSync(link);
    return true;
  } catch {
    return false;
  }
}

function linkGlobal() {
  try {
    execFileSync(npmCommand(), ['link'], {
      cwd: repoRoot(),
      stdio: 'inherit',
      // Windows cannot execute .cmd files without a shell.
      shell: process.platform === 'win32',
    });
    return true;
  } catch (e) {
    log.warn(`npm link failed: ${e.message}`);
    return false;
  }
}

function unlinkGlobal() {
  try {
    execFileSync(npmCommand(), ['unlink', '-g'], {
      cwd: repoRoot(),
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    return true;
  } catch (e) {
    log.warn(`npm unlink failed: ${e.message}`);
    return false;
  }
}

export function runInstall({ config, skipLink = false } = {}) {
  console.log('');
  console.log('  installazione di hoepli-extract');
  console.log('');
  const linked = skipLink ? true : linkGlobal();
  console.log(`  comando globale      ${linked ? 'ok (hoepli disponibile ovunque)' : 'non riuscito'}`);

  const saved = saveConfig({ outputDir: config.outputDir, openAfter: config.openAfter });
  console.log(`  configurazione       ${configPath()}`);
  console.log(`  cartella di output   ${saved.outputDir}`);

  const shortcut = createShortcut();
  if (shortcut) console.log(`  shortcut sul desktop  ${shortcutPath()}`);
  else if (process.platform === 'win32') {
    console.log(`  shortcut sul desktop  non creato: puoi usare "${path.join(repoRoot(), 'Avvia-Hoepli.cmd')}"`);
  }

  console.log('');
  console.log('  prossimo passo: apri un terminale e digita "hoepli"');
  console.log('');
  return { linked, shortcut };
}

export function runUninstall() {
  console.log('');
  const unlinked = unlinkGlobal();
  const removed = removeShortcut();
  console.log(`  comando globale      ${unlinked ? 'rimosso' : 'non rimosso'}`);
  console.log(`  shortcut sul desktop  ${removed ? 'rimosso' : 'non presente'}`);
  console.log('');
  return { unlinked, removed };
}

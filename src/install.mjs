// "hoepli install": make the command available everywhere, remember the
// preferences and put a launcher on the desktop.
//
// The desktop launcher is platform specific: a .lnk shortcut on Windows, a
// .command script on macOS and a .desktop entry on Linux.

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

/** Name of the desktop launcher for the current platform. */
export function launcherName(platform = process.platform) {
  if (platform === 'win32') return 'Hoepli.lnk';
  if (platform === 'darwin') return 'Hoepli.command';
  return 'Hoepli.desktop';
}

export function launcherPath(platform = process.platform) {
  return path.join(desktopDir(), launcherName(platform));
}

/** Content of the macOS launcher. */
export function macosLauncherScript() {
  return [
    '#!/bin/bash',
    `# ${binPath()}`,
    'cd "' + repoRoot() + '" || exit 1',
    `exec "${process.execPath}" "${binPath()}" "$@"`,
    '',
  ].join('\n');
}

/** Content of the Linux desktop entry. */
export function linuxDesktopEntry() {
  const exec = `"${process.execPath}" "${binPath()}"`;
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Hoepli',
    'Comment=Export the books you are licensed to read on HoepliAcademy+',
    `Exec=${exec}`,
    `Path=${repoRoot()}`,
    'Terminal=true',
    'Categories=Utility;',
    '',
  ].join('\n');
}

/** Content of the POSIX launcher installed in ~/.local/bin. */
export function posixLauncherScript() {
  return ['#!/bin/sh', `exec "${process.execPath}" "${binPath()}" "$@"`, ''].join('\n');
}

function writeExecutable(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  try {
    fs.chmodSync(file, 0o755);
  } catch {
    /* best effort on filesystems without permissions */
  }
}

/** Create the desktop launcher; returns the path or null when not possible. */
export function createLauncher(platform = process.platform) {
  if (platform === 'win32') return createWindowsShortcut();
  const target = launcherPath(platform);
  try {
    if (platform === 'darwin') {
      writeExecutable(target, macosLauncherScript());
    } else {
      writeExecutable(target, linuxDesktopEntry());
    }
    return target;
  } catch (e) {
    log.debug(`launcher creation failed: ${e.message}`);
    return null;
  }
}

function createWindowsShortcut() {
  const script = path.join(ensureDir(homeDir()), 'create-shortcut.ps1');
  const target = process.execPath;
  const args = `"${binPath()}"`;
  const working = repoRoot();
  const link = launcherPath('win32');
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
    return out.includes('OK') ? link : null;
  } catch (e) {
    log.debug(`shortcut creation failed: ${e.message}`);
    return null;
  }
}

export function removeLauncher(platform = process.platform) {
  const target = launcherPath(platform);
  try {
    if (fs.existsSync(target)) fs.rmSync(target);
    return true;
  } catch {
    return false;
  }
}

/** Fallback when npm cannot write to the global prefix. */
export function localBinDir(platform = process.platform) {
  if (platform === 'win32') return path.join(process.env.APPDATA || os.homedir(), 'npm');
  return path.join(os.homedir(), '.local', 'bin');
}

function installLocalCommand() {
  const dir = localBinDir();
  const target = path.join(dir, 'hoepli');
  try {
    writeExecutable(target, posixLauncherScript());
    return target;
  } catch (e) {
    log.debug(`local command failed: ${e.message}`);
    return null;
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

function pathHint(dir) {
  const entries = (process.env.PATH || '').split(path.delimiter);
  return entries.includes(dir) ? null : dir;
}

export function runInstall({ config, skipLink = false } = {}) {
  console.log('');
  console.log(`  installazione di hoepli-extract  (${process.platform})`);
  console.log('');

  let linked = skipLink;
  if (!skipLink) linked = linkGlobal();
  let local = null;
  if (!linked) {
    local = installLocalCommand();
    console.log(`  comando globale      npm link non riuscito, uso ${local ?? 'niente'}`);
    const hint = local ? pathHint(path.dirname(local)) : null;
    if (hint) console.log(`                         aggiungi ${hint} al PATH`);
  } else {
    console.log('  comando globale      ok (hoepli disponibile ovunque)');
  }

  const saved = saveConfig({ outputDir: config.outputDir, openAfter: config.openAfter });
  console.log(`  configurazione       ${configPath()}`);
  console.log(`  cartella di output   ${saved.outputDir}`);

  const launcher = createLauncher();
  if (launcher) {
    console.log(`  launcher sul desktop ${launcher}`);
    if (process.platform === 'linux') {
      console.log('                         su GNOME potrebbe servire "Consenti l\'esecuzione"');
    }
  } else {
    console.log(`  launcher sul desktop  non creato: usa "${path.join(repoRoot(), 'Avvia-Hoepli.sh')}"`);
  }

  console.log('');
  console.log('  prossimo passo: apri un terminale e digita "hoepli"');
  console.log('');
  return { linked, local, launcher };
}

export function runUninstall() {
  console.log('');
  const unlinked = unlinkGlobal();
  const removed = removeLauncher();
  const local = path.join(localBinDir(), 'hoepli');
  let localRemoved = false;
  try {
    if (fs.existsSync(local)) {
      fs.rmSync(local);
      localRemoved = true;
    }
  } catch {
    localRemoved = false;
  }
  console.log(`  comando globale      ${unlinked ? 'rimosso' : 'non rimosso'}`);
  console.log(`  launcher sul desktop  ${removed ? 'rimosso' : 'non presente'}`);
  if (localRemoved) console.log(`  launcher locale      ${local} rimosso`);
  console.log('');
  return { unlinked, removed, localRemoved };
}

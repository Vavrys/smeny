#!/usr/bin/env node
// Vyrazí do index.html krátký git hash nasazeného buildu.
//
// Cloudflare Pages → Settings → Builds & deployments → Build command:
//     node build-stamp.js
// (Build output directory zůstává kořen repa.)
//
// CF nastavuje CF_PAGES_COMMIT_SHA. Lokálně skript spadne zpět na
// `git rev-parse HEAD`. Když není ani jedno, index.html se nechá být —
// placeholder zůstane a patička v appce ukáže jen číslo verze.
//
// Skript přepisuje index.html JEN v ephemerálním checkoutu na CI.
// Nespouštěj ho lokálně před commitem, ať se stamp nedostane do repa.
const fs = require('fs');
const { execSync } = require('child_process');

const PLACEHOLDER = '__BUILD_SHA__';
const FILE = 'index.html';

function resolveSha() {
  const env = process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA;
  if (env) return env.trim();
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch (e) {
    return '';
  }
}

const sha = resolveSha();
if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
  console.warn('[build-stamp] git hash nezjištěn — index.html ponechán beze změny.');
  process.exit(0);
}

const src = fs.readFileSync(FILE, 'utf8');
if (!src.includes(PLACEHOLDER)) {
  console.warn('[build-stamp] placeholder ' + PLACEHOLDER + ' v index.html nenalezen — nic k nahrazení.');
  process.exit(0);
}

fs.writeFileSync(FILE, src.split(PLACEHOLDER).join(sha), 'utf8');
console.log('[build-stamp] build = ' + sha.slice(0, 7));

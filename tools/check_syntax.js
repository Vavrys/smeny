// Ověří syntaxi JS v repu bez spuštění appky:
//   - vytáhne všechny inline <script> bloky bez src z ../index.html (type
//     prázdný/text/javascript → .js přes node --check, type="module" → .mjs)
//   - zkontroluje i ../sw.js a ../build-stamp.js, pokud existují
// Při chybě vypíše číslo bloku a řádek v index.html, kde blok začíná, a skončí exit 1.
//
// Spuštění: node check_syntax.js   (z tools/, nebo `npm test` z tools/)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let fail = false;

function checkTempFile(ext, code, label) {
  const tmp = path.join(os.tmpdir(), `smeny-check-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  fs.writeFileSync(tmp, code, 'utf8');
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    console.log(`OK  ${label}`);
  } catch (e) {
    fail = true;
    const msg = (e.stderr || e.stdout || e.message || '').toString().trim();
    console.error(`CHYBA  ${label}`);
    console.error(msg);
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) { /* nevadí */ }
  }
}

// ── inline <script> blocky z index.html ─────────────────────────────────
const indexPath = path.join(ROOT, 'index.html');
const html = fs.readFileSync(indexPath, 'utf8');

// najde <script ...> bez atributu src a zjistí type, pak obsah až po </script>
const scriptOpenRe = /<script\b([^>]*)>/gi;
let match;
let blockNum = 0;
while ((match = scriptOpenRe.exec(html))) {
  const attrs = match[1];
  if (/\bsrc\s*=/i.test(attrs)) continue; // externí skript, nekontrolujeme

  const typeMatch = attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)["']?/i);
  const type = typeMatch ? typeMatch[1].toLowerCase() : '';
  if (type && type !== 'text/javascript' && type !== 'module' && type !== 'application/javascript') {
    continue; // např. type="application/json" — nejde o JS
  }

  const bodyStart = match.index + match[0].length;
  const closeIdx = html.indexOf('</script>', bodyStart);
  if (closeIdx === -1) continue;
  const code = html.slice(bodyStart, closeIdx);

  blockNum += 1;
  const line = html.slice(0, bodyStart).split('\n').length;
  const ext = type === 'module' ? '.mjs' : '.js';
  checkTempFile(ext, code, `index.html blok #${blockNum} (řádek ${line})`);
}

if (blockNum === 0) {
  fail = true;
  console.error('V index.html nebyl nalezen žádný inline <script> bez src.');
}

// ── samostatné soubory, pokud existují ───────────────────────────────────
for (const rel of ['sw.js', 'build-stamp.js']) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) continue;
  checkTempFile('.js', fs.readFileSync(p, 'utf8'), rel);
}

process.exit(fail ? 1 : 0);

#!/usr/bin/env node
// scripts/shoot.js — visuelles Self-Test-Tool
//
// Zweck: ohne echte Handys einen definierten Punkt im Spiel ansteuern und
// einen PNG-Screenshot ablegen, damit der Agent visuell prüfen kann, ob
// eine Implementierung Erfolg hatte.
//
// Voraussetzungen:
//  - npm run start läuft auf http://localhost:3000 (oder PORT übergeben)
//  - System-Chrome / Edge / Chromium ist installiert (kein Browser-Download)
//  - puppeteer-core als devDependency
//
// Aufruf:
//   npm run shoot -- HikeScene tree-blocker
//   npm run shoot -- HikeScene 5800
//   npm run shoot -- HikeScene tree-blocker --name=tree-fix-attempt-1
//
// Speicherort: screenshots/<name>.png  (Standard-Name = "<scene>-<warp>")

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch (_) {
  console.error('[shoot] puppeteer-core fehlt — bitte einmal `npm install` ausführen.');
  process.exit(1);
}

// ----- CLI-Parsing ------------------------------------------------------
const args = process.argv.slice(2);
let scene = 'HikeScene';
let warp = 'tree-blocker';
let name = null;
let port = process.env.PORT || 3000;
let viewportW = 1280, viewportH = 800;
let timeoutMs = 10000;

const positional = [];
for (const a of args) {
  if (a.startsWith('--name=')) name = a.slice('--name='.length);
  else if (a.startsWith('--port=')) port = parseInt(a.slice('--port='.length), 10);
  else if (a.startsWith('--w=')) viewportW = parseInt(a.slice('--w='.length), 10);
  else if (a.startsWith('--h=')) viewportH = parseInt(a.slice('--h='.length), 10);
  else if (a.startsWith('--timeout=')) timeoutMs = parseInt(a.slice('--timeout='.length), 10);
  else positional.push(a);
}
if (positional[0]) scene = positional[0];
if (positional[1]) warp = positional[1];
if (!name) name = `${scene}-${warp}`.replace(/[^a-zA-Z0-9_-]/g, '_');

// ----- System-Browser finden (Windows-Priorität, dann macOS/Linux) -----
function findBrowser() {
  const env = process.env;
  const candidates = [];
  if (process.platform === 'win32') {
    const pf = env['ProgramFiles'] || 'C:/Program Files';
    const pf86 = env['ProgramFiles(x86)'] || 'C:/Program Files (x86)';
    const local = env['LOCALAPPDATA'] || '';
    candidates.push(
      path.join(pf, 'Google/Chrome/Application/chrome.exe'),
      path.join(pf86, 'Google/Chrome/Application/chrome.exe'),
      path.join(local, 'Google/Chrome/Application/chrome.exe'),
      path.join(pf, 'Microsoft/Edge/Application/msedge.exe'),
      path.join(pf86, 'Microsoft/Edge/Application/msedge.exe'),
      path.join(pf, 'Chromium/Application/chrome.exe')
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge'
    );
  }
  if (env.CHROME_PATH) candidates.unshift(env.CHROME_PATH);
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch (_) { /* ignore */ }
  }
  return null;
}

// ----- Server-Erreichbarkeit prüfen ------------------------------------
function pingServer(p) {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${p}/`, res => {
      res.resume();
      resolve(res.statusCode != null && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

// ----- Hauptablauf ------------------------------------------------------
(async () => {
  const browserPath = findBrowser();
  if (!browserPath) {
    console.error('[shoot] Kein System-Browser gefunden.');
    console.error('        Setze CHROME_PATH=... oder installiere Chrome/Edge.');
    process.exit(1);
  }
  console.log(`[shoot] Browser:     ${browserPath}`);

  const reachable = await pingServer(port);
  if (!reachable) {
    console.error(`[shoot] http://localhost:${port} nicht erreichbar — läuft \`npm run start\`?`);
    process.exit(1);
  }

  const outDir = path.resolve(__dirname, '..', 'screenshots');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${name}.png`);

  const url = `http://localhost:${port}/?dev=1&scene=${encodeURIComponent(scene)}&warp=${encodeURIComponent(warp)}`;
  console.log(`[shoot] URL:         ${url}`);

  const browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width: viewportW, height: viewportH }
  });

  let exitCode = 0;
  try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.error('[page error]', e.message));
    page.on('console', msg => {
      const t = msg.type();
      if (t === 'error' || t === 'warning') {
        console.error(`[page ${t}]`, msg.text());
      }
    });
    page.on('requestfailed', req => {
      console.error('[page reqfail]', req.url(), req.failure() && req.failure().errorText);
    });
    page.on('response', res => {
      if (res.status() >= 400) {
        console.error(`[page http ${res.status()}]`, res.url());
      }
    });

    await page.goto(url, { waitUntil: 'domcontentloaded' });

    try {
      await page.waitForFunction(
        () => window.__SCENE_READY === true,
        { timeout: timeoutMs }
      );
    } catch (waitErr) {
      const diag = await page.evaluate(() => ({
        dev: window.__DEV,
        ready: window.__SCENE_READY,
        botId: window.__DEV_BOT_ID,
        gameExists: typeof window.game !== 'undefined' && !!window.game,
        scenesActive: window.game && window.game.scene
          ? window.game.scene.scenes.filter(s => s.scene && s.scene.isActive && s.scene.isActive()).map(s => s.scene.key)
          : null,
        title: document.title
      }));
      console.error('[shoot] Diag:', JSON.stringify(diag, null, 2));
      throw waitErr;
    }
    // Letzter Frame der Tween-/Camera-Lerps
    await new Promise(r => setTimeout(r, 250));

    await page.screenshot({ path: outPath, fullPage: false });
    console.log(`[shoot] OK → ${path.relative(process.cwd(), outPath)}`);
  } catch (e) {
    console.error('[shoot] Fehler:', e.message);
    exitCode = 2;
  } finally {
    await browser.close();
  }
  process.exit(exitCode);
})();

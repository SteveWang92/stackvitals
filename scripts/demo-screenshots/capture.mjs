// Captures 1920x1080 demo screenshots of the dashboard for use on public pages.
// Starts a Vite dev server with VITE_DEMO_MODE=true (auth gate skipped, data served
// from src/data/demoDashboardData.ts instead of Supabase), drives a local Edge/Chrome
// with puppeteer-core, and writes PNGs to scripts/demo-screenshots/output/.
//
// Viewport size is 1920x1080. The site's copy-assets.mjs crops the overview screenshot
// using a margin derived from this width and the app's content max-width (see
// src/styles.css .app-shell). If you change the viewport here, update the crop margin
// in site/scripts/copy-assets.mjs.
//
// Usage: npm run demo:screenshots

/* global document, window -- page.evaluate callbacks run in the browser */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const outDir = path.join(scriptDir, 'output');
const port = 5199;
const baseUrl = `http://localhost:${port}`;

function findBrowserExecutable() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);

  const found = candidates.find((candidate) => existsSync(candidate));

  if (!found) {
    throw new Error('No Edge/Chrome executable found. Set PUPPETEER_EXECUTABLE_PATH to a Chromium-based browser.');
  }

  return found;
}

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);

      if (response.ok) {
        return;
      }
    } catch {
      // Server not up yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Dev server did not become ready at ${url} within ${timeoutMs} ms.`);
}

function startDevServer() {
  const viteBin = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');

  return spawn(process.execPath, [viteBin, '--port', String(port), '--strictPort'], {
    cwd: repoRoot,
    env: { ...process.env, VITE_DEMO_MODE: 'true' },
    stdio: 'ignore',
  });
}

async function captureScreenshots() {
  const browser = await puppeteer.launch({
    executablePath: findBrowserExecutable(),
    headless: true,
    args: ['--window-size=1920,1080', '--hide-scrollbars'],
    defaultViewport: { width: 1920, height: 1080 },
  });

  try {
    const page = await browser.newPage();

    await page.goto(baseUrl, { waitUntil: 'load' });
    await page.waitForFunction(() => document.body.innerText.includes('Recipe Box'), { timeout: 15_000 });
    await new Promise((resolve) => setTimeout(resolve, 500));

    async function shot(name) {
      await page.screenshot({ path: path.join(outDir, `${name}.png`) });
      console.log(`saved ${name}.png`);
    }

    async function clickTab(label) {
      await page.evaluate((text) => {
        const button = [...document.querySelectorAll('.dashboard-tab')].find((el) => el.textContent.trim() === text);

        if (!button) {
          throw new Error(`tab not found: ${text}`);
        }

        button.click();
      }, label);
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    async function scrollToTabs() {
      await page.evaluate(() => {
        const nav = document.querySelector('.dashboard-tabs');
        window.scrollTo({ top: nav.getBoundingClientRect().top + window.scrollY - 16, behavior: 'instant' });
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise((resolve) => setTimeout(resolve, 300));
    await shot('01-overview');

    const tabs = [
      ['App Detail', '02-app-detail'],
      ['Collectors', '03-collectors'],
      ['Domains', '04-domains'],
      ['Usage', '05-usage'],
      ['Costs', '06-costs'],
    ];

    for (const [label, file] of tabs) {
      await clickTab(label);
      await scrollToTabs();
      await shot(file);
    }
  } finally {
    await browser.close();
  }
}

mkdirSync(outDir, { recursive: true });

const devServer = startDevServer();

try {
  await waitForServer(baseUrl);
  await captureScreenshots();
  console.log(`Screenshots written to ${outDir}`);
} finally {
  devServer.kill();
}

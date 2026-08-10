import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const BASE = 'https://stepoil-debug.github.io/conutway/';
const HERO = `${BASE}assets/conutway-brazil-china-hero-user.webp`;
const LOGO = `${BASE}assets/conutway-teza-logo-user.webp`;
const report = {
  startedAt: new Date().toISOString(),
  loginStatus: null,
  buildMarker: null,
  heroStatus: null,
  heroBytes: null,
  heroVisible: false,
  heroNaturalWidth: null,
  heroNaturalHeight: null,
  logoStatus: null,
  logoBytes: null,
  logoVisible: false,
  logoNaturalWidth: null,
  logoNaturalHeight: null,
  invalidCredentialRejected: false,
  validCredentialAccepted: false,
  logoutWorked: false,
  consoleErrors: [],
  pageErrors: [],
  requestFailures: [],
  httpErrors: [],
  criticalHttpErrors: [],
  finishedAt: null,
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

page.on('console', (message) => {
  if (message.type() === 'error') report.consoleErrors.push(message.text());
});
page.on('pageerror', (error) => report.pageErrors.push(String(error)));
page.on('requestfailed', (request) => {
  report.requestFailures.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText || 'failed'}`);
});
page.on('response', (response) => {
  if (response.status() < 400) return;
  const item = `${response.status()} ${response.url()}`;
  report.httpErrors.push(item);
  try {
    const url = new URL(response.url());
    const criticalNames = [
      'login.html','index.html','app.js','styles.css','storage.js','permissions.js',
      'conutway-brazil-china-hero-user.webp','conutway-teza-logo-user.webp'
    ];
    if (url.origin === new URL(BASE).origin && criticalNames.some((name) => url.pathname.endsWith('/' + name))) {
      report.criticalHttpErrors.push(item);
    }
  } catch (_) {}
});

const fail = (message) => { throw new Error(message); };

async function fetchWebp(url, label, minBytes) {
  const response = await context.request.get(url, { timeout: 30000 });
  const body = await response.body();
  if (response.status() !== 200) fail(`${label} respondeu HTTP ${response.status()}`);
  if (body.length < minBytes) fail(`${label} muito pequeno: ${body.length} bytes`);
  if (body.subarray(0, 4).toString('ascii') !== 'RIFF' || body.subarray(8, 12).toString('ascii') !== 'WEBP') {
    fail(`${label} publicado não é um WebP válido.`);
  }
  return { status: response.status(), bytes: body.length };
}

try {
  const heroFetch = await fetchWebp(HERO, 'Hero', 10000);
  report.heroStatus = heroFetch.status;
  report.heroBytes = heroFetch.bytes;
  const logoFetch = await fetchWebp(LOGO, 'Logo', 1000);
  report.logoStatus = logoFetch.status;
  report.logoBytes = logoFetch.bytes;

  const loginResponse = await page.goto(`${BASE}login.html`, { waitUntil: 'networkidle', timeout: 30000 });
  report.loginStatus = loginResponse?.status() ?? null;
  if (report.loginStatus !== 200) fail(`login.html respondeu HTTP ${report.loginStatus}`);
  if (!(await page.locator('#loginForm').isVisible())) fail('Formulário de login não ficou visível.');
  if (!((await page.title()).includes('CONUTWAY TEZA'))) fail(`Título inesperado no login: ${await page.title()}`);

  report.buildMarker = await page.locator('meta[name="conutway-build"]').getAttribute('content');
  if (report.buildMarker !== 'premium-user-assets-v15') fail(`Build visual inesperado: ${report.buildMarker}`);

  const hero = page.locator('.hero-image');
  await hero.waitFor({ state: 'visible', timeout: 10000 });
  report.heroVisible = await hero.isVisible();
  if (!report.heroVisible) fail('Imagem China/Brasil não ficou visível no hero.');
  const heroBox = await hero.boundingBox();
  if (!heroBox || heroBox.width < 650 || heroBox.height < 600) fail(`Hero com área inesperada: ${JSON.stringify(heroBox)}`);
  const heroMetrics = await hero.evaluate((el) => ({
    complete: el.complete,
    naturalWidth: el.naturalWidth,
    naturalHeight: el.naturalHeight,
    src: el.currentSrc,
  }));
  report.heroNaturalWidth = heroMetrics.naturalWidth;
  report.heroNaturalHeight = heroMetrics.naturalHeight;
  if (!heroMetrics.complete || heroMetrics.naturalWidth < 700 || heroMetrics.naturalHeight < 300) {
    fail(`Imagem do hero não decodificou corretamente: ${JSON.stringify(heroMetrics)}`);
  }
  if (!heroMetrics.src.endsWith('/conutway/assets/conutway-brazil-china-hero-user.webp')) {
    fail(`Hero aponta para recurso inesperado: ${heroMetrics.src}`);
  }

  const logo = page.locator('.logo-card img');
  await logo.waitFor({ state: 'visible', timeout: 10000 });
  report.logoVisible = await logo.isVisible();
  const logoMetrics = await logo.evaluate((el) => ({
    complete: el.complete,
    naturalWidth: el.naturalWidth,
    naturalHeight: el.naturalHeight,
    src: el.currentSrc,
  }));
  report.logoNaturalWidth = logoMetrics.naturalWidth;
  report.logoNaturalHeight = logoMetrics.naturalHeight;
  if (!logoMetrics.complete || logoMetrics.naturalWidth < 200 || logoMetrics.naturalHeight < 60) {
    fail(`Logo não decodificou corretamente: ${JSON.stringify(logoMetrics)}`);
  }
  if (!logoMetrics.src.endsWith('/conutway/assets/conutway-teza-logo-user.webp')) {
    fail(`Logo aponta para recurso inesperado: ${logoMetrics.src}`);
  }

  await page.screenshot({ path: 'pages-login-audit.png', fullPage: true });

  await page.locator('#username').fill('admin');
  await page.locator('#password').fill('senha-incorreta');
  await page.locator('#submitBtn').click();
  await page.locator('#loginError.visible').waitFor({ state: 'visible', timeout: 5000 });
  if (!page.url().includes('login.html')) fail('Credencial inválida saiu da tela de login.');
  report.invalidCredentialRejected = true;

  await page.locator('#username').fill('admin');
  await page.locator('#password').fill('admin');
  await page.locator('#submitBtn').click();
  await page.waitForURL((url) => url.pathname === '/conutway/' || url.pathname === '/conutway', { timeout: 15000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 15000 });
  if (!((await page.title()).includes('CONUTWAY TEZA BR WORKSPACE'))) fail(`Workspace não carregou após login: ${await page.title()}`);
  report.validCredentialAccepted = true;

  const more = page.locator('.topbar-more > summary');
  if (await more.isVisible()) await more.click();
  const logout = page.locator('#logoutBtn');
  await logout.waitFor({ state: 'visible', timeout: 5000 });
  await logout.click();
  await page.waitForURL((url) => url.pathname.endsWith('/conutway/login.html'), { timeout: 10000 });
  await page.locator('#loginForm').waitFor({ state: 'visible', timeout: 10000 });
  report.logoutWorked = true;

  if (report.criticalHttpErrors.length) fail(`HTTP crítico: ${report.criticalHttpErrors.join(' | ')}`);
  if (report.pageErrors.length) fail(`Erros de página: ${report.pageErrors.join(' | ')}`);
  if (report.requestFailures.length) fail(`Falhas de rede: ${report.requestFailures.join(' | ')}`);

  report.finishedAt = new Date().toISOString();
  await fs.writeFile('pages-login-audit.json', JSON.stringify({ ok: true, report }, null, 2));
  console.log(JSON.stringify({ ok: true, report }, null, 2));
} catch (error) {
  report.finishedAt = new Date().toISOString();
  report.error = String(error?.stack || error);
  await page.screenshot({ path: 'pages-login-audit.png', fullPage: true }).catch(() => {});
  await fs.writeFile('pages-login-audit.json', JSON.stringify({ ok: false, report }, null, 2));
  console.error(JSON.stringify({ ok: false, report }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}

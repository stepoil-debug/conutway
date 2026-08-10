import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const BASE = 'https://stepoil-debug.github.io/conutway/';
const HERO = `${BASE}assets/conutway-brazil-china-hero-v7.webp`;
const LOGO = `${BASE}assets/conutway-teza-logo-v7.webp`;
const report = {
  startedAt: new Date().toISOString(),
  loginStatus: null,
  buildMarker: null,
  heroStatus: null,
  heroSize: null,
  logoStatus: null,
  logoSize: null,
  invalidCredentialRejected: false,
  validCredentialAccepted: false,
  logoutWorked: false,
  consoleErrors: [],
  pageErrors: [],
  requestFailures: [],
  httpErrors: [],
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
  if (response.status() >= 400) report.httpErrors.push(`${response.status()} ${response.url()}`);
});

const fail = (message) => { throw new Error(message); };

async function assertImage(url, label, minWidth, minHeight) {
  const response = await page.request.get(url, { timeout: 15000 });
  const status = response.status();
  if (status !== 200) fail(`${label} respondeu HTTP ${status}: ${url}`);
  const dimensions = await page.evaluate(async (src) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  }, url);
  if (dimensions.width < minWidth || dimensions.height < minHeight) {
    fail(`${label} não decodificou corretamente: ${dimensions.width}x${dimensions.height}`);
  }
  return { status, dimensions };
}

try {
  const loginResponse = await page.goto(`${BASE}login.html`, { waitUntil: 'networkidle', timeout: 30000 });
  report.loginStatus = loginResponse?.status() ?? null;
  if (report.loginStatus !== 200) fail(`login.html respondeu HTTP ${report.loginStatus}`);
  if (!(await page.locator('#loginForm').isVisible())) fail('Formulário de login não ficou visível.');
  if (!((await page.title()).includes('CONUTWAY TEZA'))) fail(`Título inesperado no login: ${await page.title()}`);

  report.buildMarker = await page.locator('meta[name="conutway-build"]').getAttribute('content');
  if (report.buildMarker !== 'premium-assets-v7') fail(`Build visual inesperado: ${report.buildMarker}`);

  const heroResult = await assertImage(HERO, 'Hero', 700, 300);
  report.heroStatus = heroResult.status;
  report.heroSize = heroResult.dimensions;
  const logoResult = await assertImage(LOGO, 'Logo', 200, 70);
  report.logoStatus = logoResult.status;
  report.logoSize = logoResult.dimensions;

  const heroBackground = await page.locator('.hero-photo').evaluate((element) => getComputedStyle(element).backgroundImage);
  if (!heroBackground.includes('conutway-brazil-china-hero-v7.webp')) fail(`Background do hero inesperado: ${heroBackground}`);

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

  if (report.httpErrors.length) fail(`Respostas HTTP com erro: ${report.httpErrors.join(' | ')}`);
  if (report.consoleErrors.length) fail(`Erros de console: ${report.consoleErrors.join(' | ')}`);
  if (report.pageErrors.length) fail(`Erros de página: ${report.pageErrors.join(' | ')}`);
  if (report.requestFailures.length) fail(`Falhas de rede: ${report.requestFailures.join(' | ')}`);

  await page.screenshot({ path: 'pages-login-audit.png', fullPage: true });
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

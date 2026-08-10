import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const BASE = 'https://stepoil-debug.github.io/conutway/';
const report = {
  startedAt: new Date().toISOString(),
  loginStatus: null,
  heroLoaded: false,
  heroBackground: null,
  invalidCredentialRejected: false,
  validCredentialAccepted: false,
  logoutWorked: false,
  consoleErrors: [],
  pageErrors: [],
  requestFailures: [],
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

const fail = (message) => {
  throw new Error(message);
};

try {
  const loginResponse = await page.goto(`${BASE}login.html`, { waitUntil: 'networkidle', timeout: 30000 });
  report.loginStatus = loginResponse?.status() ?? null;
  if (report.loginStatus !== 200) fail(`login.html respondeu HTTP ${report.loginStatus}`);
  if (!(await page.locator('#loginForm').isVisible())) fail('Formulário de login não ficou visível.');
  if (!((await page.title()).includes('CONUTWAY TEZA'))) fail(`Título inesperado no login: ${await page.title()}`);

  const hero = page.locator('.hero-photo');
  await hero.waitFor({ state: 'attached', timeout: 5000 });
  await page.waitForFunction(() => document.querySelector('.hero-photo')?.dataset.loaded === 'true', null, { timeout: 10000 });
  report.heroBackground = await hero.evaluate((element) => getComputedStyle(element).backgroundImage);
  report.heroLoaded = report.heroBackground.includes('data:image/webp;base64,');
  if (!report.heroLoaded) fail('Arte Brasil-China não foi aplicada ao fundo do login.');

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

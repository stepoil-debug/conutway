import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const BASE = 'https://stepoil-debug.github.io/conutway/';
const HERO = `${BASE}assets/conutway-hero-user-v9.webp`;
const report = {
  startedAt: new Date().toISOString(),
  loginStatus: null,
  buildMarker: null,
  heroStatus: null,
  heroBytes: null,
  heroVisible: false,
  heroNaturalWidth: null,
  heroNaturalHeight: null,
  logoVisible: false,
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
    const criticalNames = ['login.html','index.html','app.js','styles.css','storage.js','permissions.js','conutway-hero-user-v9.webp'];
    if (url.origin === new URL(BASE).origin && criticalNames.some((name) => url.pathname.endsWith('/' + name))) {
      report.criticalHttpErrors.push(item);
    }
  } catch (_) {}
});

const fail = (message) => { throw new Error(message); };

try {
  const heroResponse = await context.request.get(HERO, { timeout: 30000 });
  report.heroStatus = heroResponse.status();
  const heroBody = await heroResponse.body();
  report.heroBytes = heroBody.length;
  if (report.heroStatus !== 200) fail(`Hero respondeu HTTP ${report.heroStatus}`);
  if (heroBody.length !== 49512) fail(`Hero com tamanho inesperado: ${heroBody.length} bytes`);
  if (heroBody.subarray(0, 4).toString('ascii') !== 'RIFF' || heroBody.subarray(8, 12).toString('ascii') !== 'WEBP') {
    fail('Hero publicado não é um WebP válido.');
  }

  const loginResponse = await page.goto(`${BASE}login.html`, { waitUntil: 'networkidle', timeout: 30000 });
  report.loginStatus = loginResponse?.status() ?? null;
  if (report.loginStatus !== 200) fail(`login.html respondeu HTTP ${report.loginStatus}`);
  if (!(await page.locator('#loginForm').isVisible())) fail('Formulário de login não ficou visível.');
  if (!((await page.title()).includes('CONUTWAY TEZA'))) fail(`Título inesperado no login: ${await page.title()}`);

  report.buildMarker = await page.locator('meta[name="conutway-build"]').getAttribute('content');
  if (report.buildMarker !== 'premium-user-hero-v9') fail(`Build visual inesperado: ${report.buildMarker}`);

  const hero = page.locator('.hero-image');
  await hero.waitFor({ state: 'visible', timeout: 10000 });
  report.heroVisible = await hero.isVisible();
  if (!report.heroVisible) fail('Imagem enviada não ficou visível no hero.');
  const heroBox = await hero.boundingBox();
  if (!heroBox || heroBox.width < 650 || heroBox.height < 600) fail(`Hero com dimensões inesperadas: ${JSON.stringify(heroBox)}`);
  const heroMetrics = await hero.evaluate((el) => ({
    complete: el.complete,
    naturalWidth: el.naturalWidth,
    naturalHeight: el.naturalHeight,
    src: el.currentSrc,
  }));
  report.heroNaturalWidth = heroMetrics.naturalWidth;
  report.heroNaturalHeight = heroMetrics.naturalHeight;
  if (!heroMetrics.complete || heroMetrics.naturalWidth !== 1000 || heroMetrics.naturalHeight !== 440) {
    fail(`Imagem do hero não decodificou corretamente: ${JSON.stringify(heroMetrics)}`);
  }
  if (!heroMetrics.src.endsWith('/conutway/assets/conutway-hero-user-v9.webp')) fail(`Hero aponta para recurso inesperado: ${heroMetrics.src}`);

  const logo = page.locator('.logo-card');
  report.logoVisible = await logo.isVisible();
  if (!report.logoVisible) fail('Logo CONUTWAY TEZA não ficou visível.');
  const logoText = (await logo.innerText()).replace(/\s+/g, ' ').trim();
  if (!logoText.includes('CONUTWAY') || !logoText.includes('TEZA')) fail(`Logo textual inesperada: ${logoText}`);

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

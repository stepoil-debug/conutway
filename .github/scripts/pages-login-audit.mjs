import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const BASE = 'https://stepoil-debug.github.io/conutway/';
const HERO = `${BASE}assets/conutway-brazil-china-hero.webp`;
const LOGO = `${BASE}assets/conutway-teza-logo-v2.svg`;
const EXPECTED_MODULES = [
  'dashboard','internalRfqs','customers','projects','contracts','projectAccounts',
  'suppliers','purchaseOrders','inventory','products','options','documents','sellers','users'
];
const report = {
  startedAt: new Date().toISOString(), loginStatus: null, buildMarker: null,
  heroStatus: null, heroBytes: null, heroVisible: false, heroBox: null,
  heroNaturalWidth: null, heroNaturalHeight: null, logoStatus: null, logoVisible: false,
  workspaceTheme: null, workspaceModules: [], workspaceBrandLogo: null, workspaceSidebarWidth: null,
  invalidCredentialRejected: false, validCredentialAccepted: false, logoutWorked: false,
  consoleErrors: [], pageErrors: [], requestFailures: [], httpErrors: [], criticalHttpErrors: [], finishedAt: null,
};
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on('console', (message) => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
page.on('pageerror', (error) => report.pageErrors.push(String(error)));
page.on('requestfailed', (request) => report.requestFailures.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText || 'failed'}`));
page.on('response', (response) => {
  if (response.status() < 400) return;
  const item = `${response.status()} ${response.url()}`; report.httpErrors.push(item);
  try {
    const url = new URL(response.url());
    const criticalNames = ['login.html','index.html','app.js','styles.css','storage.js','permissions.js','conutway-brazil-china-hero.webp','conutway-teza-logo-v2.svg'];
    if (url.origin === new URL(BASE).origin && criticalNames.some((name) => url.pathname.endsWith('/' + name))) report.criticalHttpErrors.push(item);
  } catch (_) {}
});
const fail = (message) => { throw new Error(message); };
try {
  const heroResponse = await context.request.get(HERO, { timeout: 30000 });
  report.heroStatus = heroResponse.status();
  const heroBody = await heroResponse.body(); report.heroBytes = heroBody.length;
  if (report.heroStatus !== 200) fail(`Hero respondeu HTTP ${report.heroStatus}`);
  if (heroBody.length !== 73684) fail(`Hero com tamanho inesperado: ${heroBody.length} bytes`);
  if (heroBody.subarray(0,4).toString('ascii') !== 'RIFF' || heroBody.subarray(8,12).toString('ascii') !== 'WEBP') fail('Hero publicado não é um WebP válido.');
  const logoResponse = await context.request.get(LOGO, { timeout: 30000 });
  report.logoStatus = logoResponse.status();
  if (report.logoStatus !== 200) fail(`Logo respondeu HTTP ${report.logoStatus}`);
  const logoText = await logoResponse.text();
  if (!logoText.includes('<svg') || !logoText.includes('CONUTWAY') || !logoText.includes('TEZA')) fail('Logo publicado é inválido.');

  const loginResponse = await page.goto(`${BASE}login.html`, { waitUntil: 'networkidle', timeout: 30000 });
  report.loginStatus = loginResponse?.status() ?? null;
  if (report.loginStatus !== 200) fail(`login.html respondeu HTTP ${report.loginStatus}`);
  if (!(await page.locator('#loginForm').isVisible())) fail('Formulário de login não ficou visível.');
  if (!((await page.title()).includes('CONUTWAY TEZA'))) fail(`Título inesperado no login: ${await page.title()}`);
  report.buildMarker = await page.locator('meta[name="conutway-build"]').getAttribute('content');
  if (report.buildMarker !== 'target-v2-backup-hero') fail(`Build visual inesperado: ${report.buildMarker}`);
  const hero = page.locator('.hero-image'); await hero.waitFor({ state: 'visible', timeout: 10000 });
  report.heroVisible = await hero.isVisible(); if (!report.heroVisible) fail('Hero China-Brasil não ficou visível.');
  const heroBox = await hero.boundingBox(); report.heroBox = heroBox;
  if (!heroBox || heroBox.width < 850 || heroBox.height < 430) fail(`Hero pequeno ou quebrado: ${JSON.stringify(heroBox)}`);
  const heroMetrics = await hero.evaluate((el) => ({ complete: el.complete, naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight, src: el.currentSrc }));
  report.heroNaturalWidth = heroMetrics.naturalWidth; report.heroNaturalHeight = heroMetrics.naturalHeight;
  if (!heroMetrics.complete || heroMetrics.naturalWidth !== 1400 || heroMetrics.naturalHeight !== 622) fail(`Hero não decodificou na resolução preservada: ${JSON.stringify(heroMetrics)}`);
  if (!heroMetrics.src.endsWith('/conutway/assets/conutway-brazil-china-hero.webp')) fail(`Hero aponta para recurso inesperado: ${heroMetrics.src}`);
  const brandLogo = page.locator('.brand-logo'); await brandLogo.waitFor({ state: 'visible', timeout: 10000 });
  report.logoVisible = await brandLogo.isVisible();
  const logoMetrics = await brandLogo.evaluate((el) => ({ complete: el.complete, naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight, src: el.currentSrc }));
  if (!report.logoVisible || !logoMetrics.complete || logoMetrics.naturalWidth < 250 || logoMetrics.naturalHeight < 80) fail(`Logo não renderizou corretamente: ${JSON.stringify(logoMetrics)}`);
  const headline = (await page.locator('.copy h1').innerText()).replace(/\s+/g,' ').trim();
  if (!headline.includes('Controle internacional.') || !headline.includes('Decisões mais seguras.')) fail(`Headline inesperada: ${headline}`);
  const accessCard = await page.locator('.card').boundingBox(); if (!accessCard || accessCard.width < 380 || accessCard.height < 450) fail(`Card de acesso fora do padrão: ${JSON.stringify(accessCard)}`);

  await page.locator('#username').fill('admin'); await page.locator('#password').fill('senha-incorreta'); await page.locator('#submitBtn').click();
  await page.locator('#loginError.visible').waitFor({ state:'visible', timeout:5000 });
  if (!page.url().includes('login.html')) fail('Credencial inválida saiu da tela de login.'); report.invalidCredentialRejected = true;
  await page.locator('#username').fill('admin'); await page.locator('#password').fill('admin'); await page.locator('#submitBtn').click();
  await page.waitForURL((url) => url.pathname === '/conutway/' || url.pathname === '/conutway', { timeout:15000 });
  await page.locator('.app-shell').waitFor({ state:'visible', timeout:15000 });
  if (!((await page.title()).includes('CONUTWAY TEZA BR WORKSPACE'))) fail(`Workspace não carregou após login: ${await page.title()}`);
  report.validCredentialAccepted = true;

  report.workspaceTheme = await page.locator('body').getAttribute('data-workspace-theme');
  if (report.workspaceTheme !== 'premium-v1') fail(`Tema interno inesperado: ${report.workspaceTheme}`);

  report.workspaceModules = await page.locator('.module-nav button[data-module-target]').evaluateAll((nodes) => nodes.map((node) => node.dataset.moduleTarget));
  if (JSON.stringify(report.workspaceModules) !== JSON.stringify(EXPECTED_MODULES)) {
    fail(`Módulos alterados ou ausentes: ${JSON.stringify(report.workspaceModules)}`);
  }

  const workspaceLogo = page.locator('.brand-block img');
  await workspaceLogo.waitFor({ state:'visible', timeout:10000 });
  const workspaceLogoMetrics = await workspaceLogo.evaluate((el) => ({ complete: el.complete, naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight, src: el.currentSrc }));
  report.workspaceBrandLogo = workspaceLogoMetrics.src;
  if (!workspaceLogoMetrics.complete || workspaceLogoMetrics.naturalWidth < 250 || workspaceLogoMetrics.naturalHeight < 80) {
    fail(`Logo interno não renderizou corretamente: ${JSON.stringify(workspaceLogoMetrics)}`);
  }
  if (!workspaceLogoMetrics.src.endsWith('/conutway/assets/conutway-teza-logo-v2.svg')) fail(`Logo interno inesperado: ${workspaceLogoMetrics.src}`);

  const sidebarBox = await page.locator('#workspaceSidebar').boundingBox();
  report.workspaceSidebarWidth = sidebarBox?.width ?? null;
  if (!sidebarBox || sidebarBox.width < 265) fail(`Sidebar premium não foi aplicada: ${JSON.stringify(sidebarBox)}`);

  await page.screenshot({ path:'pages-workspace-audit.png', fullPage:true });

  const more = page.locator('.topbar-more > summary'); if (await more.isVisible()) await more.click();
  const logout = page.locator('#logoutBtn'); await logout.waitFor({ state:'visible', timeout:5000 }); await logout.click();
  await page.waitForURL((url) => url.pathname.endsWith('/conutway/login.html'), { timeout:10000 });
  await page.locator('#loginForm').waitFor({ state:'visible', timeout:10000 }); report.logoutWorked = true;
  if (report.criticalHttpErrors.length) fail(`HTTP crítico: ${report.criticalHttpErrors.join(' | ')}`);
  if (report.pageErrors.length) fail(`Erros de página: ${report.pageErrors.join(' | ')}`);
  if (report.requestFailures.length) fail(`Falhas de rede: ${report.requestFailures.join(' | ')}`);
  await page.screenshot({ path:'pages-login-audit.png', fullPage:true });
  report.finishedAt = new Date().toISOString(); await fs.writeFile('pages-login-audit.json', JSON.stringify({ok:true,report},null,2)); console.log(JSON.stringify({ok:true,report},null,2));
} catch (error) {
  report.finishedAt = new Date().toISOString(); report.error = String(error?.stack || error);
  await page.screenshot({ path:'pages-login-audit.png', fullPage:true }).catch(()=>{});
  await fs.writeFile('pages-login-audit.json', JSON.stringify({ok:false,report},null,2)); console.error(JSON.stringify({ok:false,report},null,2)); process.exitCode=1;
} finally { await browser.close(); }

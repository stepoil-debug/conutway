import { chromium } from 'playwright';

const BASE = process.env.CONUTWAY_BASE_URL || 'https://stepoil-debug.github.io/conutway/';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await context.newPage();
const rfqApiRequests = [];

page.on('request', (request) => {
  if (request.url().includes('/api/rfq-exchange/')) rfqApiRequests.push(request.url());
});

const fail = (message) => { throw new Error(message); };

try {
  await page.goto(`${BASE}login.html`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill('admin');
  await page.locator('#submitBtn').click();
  await page.waitForURL((url) => url.pathname.endsWith('/conutway/') || url.pathname.endsWith('/conutway'), { timeout: 15000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 15000 });

  const button = page.locator('.module-nav button[data-module-target="internalRfqs"]');
  await button.waitFor({ state: 'visible', timeout: 10000 });
  if (await button.isDisabled()) fail('Botão RFQ Interno continua desabilitado.');
  if (await button.getAttribute('hidden') !== null) fail('Botão RFQ Interno continua oculto.');

  await button.click();
  const module = page.locator('#internalRfqs');
  await module.waitFor({ state: 'visible', timeout: 10000 });
  const workspace = page.locator('#internalRfqWorkspace');
  await workspace.waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('[data-rfq-view="overview"]').waitFor({ state: 'visible', timeout: 10000 });

  const sync = page.locator('[data-rfq-action="sync"]');
  if (await sync.count()) {
    if (!(await sync.isDisabled())) fail('Sincronização remota deveria ficar desabilitada no GitHub Pages.');
  }

  await page.locator('[data-rfq-action="new"]').click();
  await page.locator('[data-rfq-view="edit"]').waitFor({ state: 'visible', timeout: 10000 });
  const subject = `QA RFQ Local ${Date.now()}`;
  await page.locator('[data-rfq-field="subject"]').fill(subject);
  await page.locator('[data-rfq-field="requirementsText"]').fill('Teste automatizado de persistência local do RFQ Interno.');
  await page.locator('[data-rfq-action="save-draft"]').click();
  await page.waitForTimeout(700);

  const rfqNumber = await page.locator('[data-rfq-field="rfqNumber"]').inputValue();
  if (!rfqNumber) fail('Número do RFQ não foi gerado.');

  await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 15000 });
  const buttonAfterReload = page.locator('.module-nav button[data-module-target="internalRfqs"]');
  await buttonAfterReload.click();
  await page.locator('[data-rfq-view="overview"]').waitFor({ state: 'visible', timeout: 10000 });

  const persisted = page.locator(`#internalRfqWorkspace [data-rfq-open="${rfqNumber}"]`);
  const persistedByText = page.locator('#internalRfqWorkspace').getByText(rfqNumber, { exact: false });
  if (!(await persisted.count()) && !(await persistedByText.count())) fail(`Rascunho ${rfqNumber} não persistiu após recarregar.`);

  await page.screenshot({ path: 'pages-workspace-rfq-audit.png', fullPage: false });

  if (rfqApiRequests.length) fail(`RFQ local disparou chamadas remotas inesperadas: ${rfqApiRequests.join(' | ')}`);

  console.log(JSON.stringify({
    ok: true,
    rfqNumber,
    subject,
    persisted: true,
    remoteRequests: rfqApiRequests,
  }, null, 2));
} finally {
  await browser.close();
}

import { chromium } from 'playwright';

const BASE = process.env.CONUTWAY_BASE || 'http://127.0.0.1:4173/conutway/';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const fail = (message) => { throw new Error(message); };

try {
  await page.goto(`${BASE}login.html`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill('admin');
  await page.locator('#submitBtn').click();
  await page.waitForURL((url) => url.pathname.endsWith('/conutway/') || url.pathname.endsWith('/conutway'), { timeout: 15000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 15000 });

  const button = page.locator('.module-nav button[data-module-target="documents"]');
  if (!(await button.isVisible())) fail('Botão Documentos e Manuais não está visível.');
  if (await button.isDisabled()) fail('Botão Documentos e Manuais está desabilitado.');
  await button.click();

  const section = page.locator('#documents');
  await section.waitFor({ state: 'visible', timeout: 10000 });
  if (!(await section.isVisible())) fail('Módulo Documentos e Manuais não abriu.');

  const qaName = `Manual QA IndexedDB ${Date.now()}`;
  await page.locator('#documentNameInput').fill(qaName);
  await page.locator('#documentUploadCategory').selectOption('manual');
  await page.locator('#documentUploadCtCode').fill('QA-DOC-001');
  await page.locator('#documentUploadInput').setInputFiles({
    name: 'manual-qa.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('CONUTWAY TEZA - teste de persistência local de Documentos e Manuais', 'utf8'),
  });

  const row = page.locator('.document-row-select', { hasText: qaName });
  await row.waitFor({ state: 'visible', timeout: 15000 });
  if (!(await row.isVisible())) fail('Documento enviado não apareceu na lista.');
  const countText = (await page.locator('#documentResultCount').innerText()).trim();
  if (!/1\s+documento/i.test(countText)) fail(`Contador inesperado após upload: ${countText}`);

  const preview = page.locator('[data-document-action="preview"]');
  if (await preview.isDisabled()) fail('Visualizar ficou desabilitado para arquivo text/plain.');
  await preview.click();
  const dialog = page.locator('#documentPreviewDialog');
  await dialog.waitFor({ state: 'visible', timeout: 5000 });
  if (!(await dialog.isVisible())) fail('Pré-visualização local não abriu.');
  await dialog.locator('[data-document-preview-close]').click();

  await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 15000 });
  const docsAfterReload = page.locator('.module-nav button[data-module-target="documents"]');
  await docsAfterReload.click();
  await page.locator('#documents').waitFor({ state: 'visible', timeout: 10000 });
  const persisted = page.locator('.document-row-select', { hasText: qaName });
  await persisted.waitFor({ state: 'visible', timeout: 10000 });
  if (!(await persisted.isVisible())) fail('Documento não persistiu no IndexedDB após recarregar.');

  await page.screenshot({ path: 'pages-workspace-documents-functional-audit.png', fullPage: false });
  console.log(JSON.stringify({
    ok: true,
    module: 'documents',
    upload: true,
    preview: true,
    persistedAfterReload: true,
    documentName: qaName,
  }, null, 2));
} catch (error) {
  await page.screenshot({ path: 'pages-workspace-documents-functional-audit.png', fullPage: false }).catch(() => {});
  console.error(error?.stack || String(error));
  process.exitCode = 1;
} finally {
  await browser.close();
}

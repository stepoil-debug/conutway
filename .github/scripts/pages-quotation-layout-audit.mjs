import { chromium } from 'playwright';

const BASE = process.env.CONUTWAY_BASE_URL || 'https://stepoil-debug.github.io/conutway/';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await context.newPage();

const fail = (message) => { throw new Error(message); };

async function pageOverflow() {
  return page.evaluate(() => ({
    innerWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
}

async function assertNoPageOverflow(label) {
  const metrics = await pageOverflow();
  if (metrics.documentWidth > metrics.innerWidth + 3 || metrics.bodyWidth > metrics.innerWidth + 3) {
    fail(`${label}: overflow horizontal da página: ${JSON.stringify(metrics)}`);
  }
  return metrics;
}

async function assertChildrenInside(selector, label) {
  const result = await page.locator(selector).evaluate((node) => {
    const parent = node.getBoundingClientRect();
    const children = [...node.children].map((child) => {
      const rect = child.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width };
    });
    return {
      parent: { left: parent.left, right: parent.right, width: parent.width },
      children,
      overflowing: children.filter((rect) => rect.left < parent.left - 2 || rect.right > parent.right + 2),
    };
  });
  if (result.overflowing.length) fail(`${label}: filhos ultrapassam o container: ${JSON.stringify(result)}`);
  return result;
}

async function assertLiveFxLayout(label) {
  const control = page.locator('#quoteCostProfileBar > .live-fx-control, #quoteCostProfileBar .live-fx-control').first();
  await control.waitFor({ state: 'visible', timeout: 10000 });
  const metrics = await control.evaluate((node) => {
    const bar = node.closest('#quoteCostProfileBar') || node.parentElement;
    const values = node.querySelector('.live-fx-values');
    const button = node.querySelector('.live-fx-refresh');
    const nr = node.getBoundingClientRect();
    const br = bar?.getBoundingClientRect();
    const vr = values?.getBoundingClientRect();
    const rr = button?.getBoundingClientRect();
    const style = getComputedStyle(node);
    const buttonStyle = button ? getComputedStyle(button) : null;
    return {
      control: { left: nr.left, right: nr.right, top: nr.top, bottom: nr.bottom, width: nr.width, height: nr.height },
      bar: br ? { left: br.left, right: br.right, top: br.top, bottom: br.bottom, width: br.width, height: br.height } : null,
      values: vr ? { left: vr.left, right: vr.right, top: vr.top, bottom: vr.bottom, width: vr.width, height: vr.height } : null,
      button: rr ? { left: rr.left, right: rr.right, top: rr.top, bottom: rr.bottom, width: rr.width, height: rr.height } : null,
      position: style.position,
      gridColumnStart: style.gridColumnStart,
      gridColumnEnd: style.gridColumnEnd,
      buttonPosition: buttonStyle?.position || '',
    };
  });

  if (!metrics.bar || !metrics.values || !metrics.button) fail(`${label}: estrutura PTAX incompleta: ${JSON.stringify(metrics)}`);
  if (metrics.control.left < metrics.bar.left - 2 || metrics.control.right > metrics.bar.right + 2) {
    fail(`${label}: controle PTAX ultrapassa o bloco de câmbio: ${JSON.stringify(metrics)}`);
  }
  if (metrics.control.bottom > metrics.bar.bottom + 2) {
    fail(`${label}: controle PTAX ficou fora do fluxo vertical do bloco: ${JSON.stringify(metrics)}`);
  }
  if (metrics.position === 'absolute' || metrics.position === 'fixed' || metrics.buttonPosition === 'absolute' || metrics.buttonPosition === 'fixed') {
    fail(`${label}: PTAX não pode usar posicionamento sobreposto: ${JSON.stringify(metrics)}`);
  }
  if (metrics.control.height > 86) {
    fail(`${label}: faixa PTAX ficou alta demais (${metrics.control.height}px), empurrando produtos para baixo.`);
  }
  const horizontal = metrics.button.left >= metrics.values.right - 2;
  const vertical = metrics.button.top >= metrics.values.bottom - 2;
  if (!horizontal && !vertical) {
    fail(`${label}: botão PTAX sobrepõe os valores: ${JSON.stringify(metrics)}`);
  }
  return metrics;
}

async function openPricing() {
  await page.locator('.module-nav button[data-module-target="projects"]').click();
  await page.locator('#projects').waitFor({ state: 'visible', timeout: 10000 });

  if (await page.locator('#projectDetail').isHidden()) {
    const open = page.locator('#projectList .record-open').first();
    await open.waitFor({ state: 'visible', timeout: 10000 });
    await open.click();
  }

  await page.locator('#projectDetail').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('[data-project-view="pricing"]').click();
  await page.locator('[data-project-panel="pricing"]').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#quoteCostProfileBar').waitFor({ state: 'visible', timeout: 10000 });
}

try {
  await page.goto(`${BASE}login.html`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill('admin');
  await page.locator('#submitBtn').click();
  await page.waitForURL((url) => url.pathname.endsWith('/conutway/') || url.pathname.endsWith('/conutway'), { timeout: 15000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 15000 });

  const layoutLink = page.locator('link[data-conutway-quotation-layout="v2"]');
  if (!(await layoutLink.count())) fail('CSS quotation-layout-v2 não foi carregado.');

  await openPricing();

  const result1600 = {
    page: await assertNoPageOverflow('1600px'),
    header: await assertChildrenInside('#projects .erp-workspace-header', 'Cabeçalho 1600px'),
    exchange: await assertChildrenInside('#quoteCostProfileBar', 'Câmbio/perfil 1600px'),
    liveFx: await assertLiveFxLayout('PTAX 1600px'),
  };

  const itemsWrap = page.locator('#projects .items-table-wrap');
  const table = page.locator('#projects .quotation-items-editor');
  const wrapBox = await itemsWrap.boundingBox();
  const tableBox = await table.boundingBox();
  if (!wrapBox || !tableBox) fail('Tabela de itens não foi localizada.');
  if (tableBox.width < 1400) fail(`Tabela de itens estreita demais: ${JSON.stringify(tableBox)}`);

  const row = page.locator('#itemsBody .quotation-item-row').first();
  if (await row.count()) {
    const fieldOverflow = await row.evaluate((node) => {
      const issues = [];
      [...node.querySelectorAll('td')].forEach((cell, index) => {
        const cellRect = cell.getBoundingClientRect();
        [...cell.querySelectorAll('input:not([type="checkbox"]),select,textarea')].forEach((control) => {
          const rect = control.getBoundingClientRect();
          if (rect.right > cellRect.right + 2 || rect.left < cellRect.left - 2) {
            issues.push({ index, cell: { left: cellRect.left, right: cellRect.right }, control: { left: rect.left, right: rect.right, width: rect.width } });
          }
        });
      });
      return issues;
    });
    if (fieldOverflow.length) fail(`Campos ultrapassam suas colunas: ${JSON.stringify(fieldOverflow)}`);
  }

  await page.screenshot({ path: 'pages-workspace-quotation-pricing-1600.png', fullPage: false });

  await page.setViewportSize({ width: 1366, height: 900 });
  await page.waitForTimeout(250);
  const result1366 = {
    page: await assertNoPageOverflow('1366px'),
    header: await assertChildrenInside('#projects .erp-workspace-header', 'Cabeçalho 1366px'),
    exchange: await assertChildrenInside('#quoteCostProfileBar', 'Câmbio/perfil 1366px'),
    liveFx: await assertLiveFxLayout('PTAX 1366px'),
  };

  const tableScroll = await itemsWrap.evaluate((node) => ({ clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, overflowX: getComputedStyle(node).overflowX }));
  if (tableScroll.scrollWidth > tableScroll.clientWidth && !['auto', 'scroll'].includes(tableScroll.overflowX)) {
    fail(`Tabela precisa rolar internamente, mas overflow-x=${tableScroll.overflowX}`);
  }

  await page.screenshot({ path: 'pages-workspace-quotation-pricing-1366.png', fullPage: false });

  console.log(JSON.stringify({
    ok: true,
    layout: 'quotation-v2',
    viewport1600: result1600,
    viewport1366: result1366,
    tableScroll,
  }, null, 2));
} catch (error) {
  await page.screenshot({ path: 'pages-workspace-quotation-pricing-error.png', fullPage: false }).catch(() => {});
  console.error(error?.stack || String(error));
  process.exitCode = 1;
} finally {
  await browser.close();
}

if (!process.exitCode) {
  await import('./pages-quotation-cost-engine-v3-audit.mjs');
}

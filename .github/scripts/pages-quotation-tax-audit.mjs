import { chromium } from 'playwright';

const BASE = process.env.CONUTWAY_BASE_URL || 'https://stepoil-debug.github.io/conutway/';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
const fail = (message) => { throw new Error(message); };

const text = async (selector) => (await page.locator(selector).innerText()).replace(/\s+/g, ' ').trim();

try {
  await page.goto(`${BASE}login.html`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill('admin');
  await page.locator('#submitBtn').click();
  await page.waitForURL((url) => url.pathname.endsWith('/conutway/') || url.pathname.endsWith('/conutway'), { timeout: 15000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 15000 });

  await page.locator('.module-nav button[data-module-target="projects"]').click();
  await page.locator('#projects').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#newProjectBtn').click();
  await page.locator('#projectDetail').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('[data-project-view="pricing"]').click();
  await page.locator('[data-project-panel="pricing"]').waitFor({ state: 'visible', timeout: 10000 });

  const profileOptions = await page.locator('#quoteCostProfileSelect option').evaluateAll((nodes) => nodes.map((node) => ({
    value: node.value,
    label: (node.textContent || '').trim(),
  })));
  const selectable = profileOptions.filter((item) => item.value);

  if (!selectable.length) {
    await page.screenshot({ path: 'pages-quotation-tax-audit-no-profile.png', fullPage: false });
    console.log(JSON.stringify({ ok: false, reason: 'no-cost-profile', profileOptions }, null, 2));
    process.exitCode = 2;
  } else {
    const selected = selectable[0];
    await page.locator('#quoteCostProfileSelect').selectOption(selected.value);
    await page.waitForTimeout(200);
    await page.locator('#applyCostProfileBtn').click();
    await page.waitForTimeout(300);

    const profileName = (await page.locator('#quoteCostProfileSelect option:checked').innerText()).trim();
    const exchange = {
      fxRate: await page.locator('#quoteFxRate').inputValue(),
      fxBufferRate: await page.locator('#quoteFxBufferRate').inputValue(),
      effectiveFxRate: await page.locator('#quoteEffectiveFxRate').inputValue(),
    };

    const controls = await page.locator('[data-project-cost-control]').evaluateAll((nodes) => nodes.map((node) => {
      const rate = node.getAttribute('data-project-cost-control') || '';
      const label = (node.querySelector('.project-cost-heading span')?.textContent || '').trim();
      const input = node.querySelector('[data-project-cost-field]');
      const checkbox = node.querySelector('[data-project-cost-enabled]');
      return {
        rate,
        label,
        value: input ? Number(input.value || 0) : null,
        enabled: checkbox ? Boolean(checkbox.checked) : true,
      };
    }));

    const row = page.locator('#itemsBody .quotation-item-row').first();
    await row.waitFor({ state: 'visible', timeout: 10000 });
    await row.locator('[data-item-field="ctCode"]').fill('CT-0001');
    await row.locator('[data-item-field="descriptionPt"]').fill('ITEM TESTE QA IMPOSTOS E TAXAS');
    await row.locator('[data-item-field="ncm"]').fill('84818099');
    await row.locator('[data-item-field="quantity"]').fill('1');
    await row.locator('[data-item-field="cifCurrency"]').selectOption('USD');
    await row.locator('[data-item-field="cifUnitPrice"]').fill('100');
    await page.waitForTimeout(500);

    const outputs = {
      landedUnitCostBrl: (await row.locator('[data-cost-output="landedUnitCostBrl"]').innerText()).trim(),
      saleUnitPriceBrl: await row.locator('[data-item-field="manualSalePriceOverride"]').inputValue(),
      referenceNetProfitUnitBrl: (await row.locator('[data-cost-output="referenceNetProfitUnitBrl"]').innerText()).trim(),
      lineTotalBrl: (await row.locator('[data-cost-output="lineTotalBrl"]').innerText()).trim(),
    };

    const summary = {
      landedTotalBrl: await text('[data-project-pricing-field="landedTotalBrl"] strong'),
      salesTotalBrl: await text('[data-project-pricing-field="salesTotalBrl"] strong'),
      estimatedSalesTaxTotalBrl: await text('[data-project-pricing-field="estimatedSalesTaxTotalBrl"] strong'),
      referenceNetProfitTotalBrl: await text('[data-project-pricing-field="referenceNetProfitTotalBrl"] strong'),
      referenceNetMarginRate: await text('[data-project-pricing-field="referenceNetMarginRate"] strong'),
    };

    const requiredRates = ['importCostRate','clearanceCostRate','localCostRate','otherCostRate','salesTaxRate','profitRate'];
    const foundRates = new Set(controls.map((item) => item.rate));
    const missingRates = requiredRates.filter((rate) => !foundRates.has(rate));
    if (missingRates.length) fail(`Controles de custo ausentes: ${missingRates.join(', ')}`);

    const byRate = Object.fromEntries(controls.map((item) => [item.rate, item]));
    const activeImportFeeRateSum = controls
      .filter((item) => item.enabled && !['profitRate','salesTaxRate'].includes(item.rate))
      .reduce((sum, item) => sum + Number(item.value || 0), 0);

    if (activeImportFeeRateSum <= 0) fail('Nenhuma taxa de importação/desembaraço/logística está ativa.');
    if (!byRate.salesTaxRate?.enabled || Number(byRate.salesTaxRate.value || 0) <= 0) fail('Impostos de venda não estão ativos.');

    await page.screenshot({ path: 'pages-quotation-tax-audit.png', fullPage: false });

    console.log(JSON.stringify({
      ok: true,
      scenario: { cifUsd: 100, quantity: 1, item: 'CT-0001' },
      profileOptions,
      selectedProfile: profileName,
      exchange,
      controls,
      outputs,
      summary,
      activeImportFeeRateSum,
    }, null, 2));
  }
} catch (error) {
  await page.screenshot({ path: 'pages-quotation-tax-audit-error.png', fullPage: false }).catch(() => {});
  console.error(error?.stack || String(error));
  process.exitCode = 1;
} finally {
  await browser.close();
}

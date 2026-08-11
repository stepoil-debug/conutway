import { chromium } from 'playwright';

const BASE = process.env.CONUTWAY_BASE_URL || 'https://stepoil-debug.github.io/conutway/';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();

const fail = (message) => { throw new Error(message); };
const parseMoney = (text = '') => {
  const normalized = String(text).replace(/[^0-9,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : 0;
};

try {
  await page.goto(`${BASE}login.html`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill('admin');
  await page.locator('#submitBtn').click();
  await page.waitForURL((url) => url.pathname.endsWith('/conutway/') || url.pathname.endsWith('/conutway'), { timeout: 15000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 15000 });

  const engineCss = page.locator('link[data-conutway-cost-engine="v3"]');
  if (!(await engineCss.count())) fail('CSS do motor V3 não foi carregado.');

  await page.locator('.module-nav button[data-module-target="projects"]').click();
  await page.locator('#projects').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#newProjectBtn').click();
  await page.locator('#projectDetail').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('[data-project-view="pricing"]').click();
  await page.locator('[data-project-panel="pricing"]').waitFor({ state: 'visible', timeout: 10000 });

  const profile = page.locator('#quoteCostProfileSelect');
  await profile.waitFor({ state: 'visible', timeout: 10000 });
  const selectedProfile = await profile.inputValue();
  const selectedText = await profile.locator('option:checked').textContent();
  if (selectedProfile !== 'cost-rj-rio-brasil-2026-v3') fail(`Perfil oficial não foi aplicado automaticamente: ${selectedProfile} / ${selectedText}`);
  if (!String(selectedText).includes('OFICIAL')) fail(`Perfil oficial sem identificação visual: ${selectedText}`);

  const panel = page.locator('#quotationDetailedCostPanel');
  await panel.waitFor({ state: 'visible', timeout: 10000 });
  if (!(await panel.getByText('Memória de cálculo da importação').count())) fail('Memória de cálculo detalhada não apareceu.');

  const cif = page.locator('[data-item-field="cifUnitPrice"]').first();
  await cif.fill('1000');
  await cif.press('Tab');
  await page.waitForTimeout(300);

  const landedText = await page.locator('[data-cost-output="landedUnitCostBrl"]').first().textContent();
  const suggestedText = await page.locator('[data-suggested-price-value]').first().textContent();
  const summaryText = await page.locator('[data-project-pricing-field="landedTotalBrl"] strong').textContent();
  const landed = parseMoney(landedText);
  const suggested = parseMoney(suggestedText);
  const summary = parseMoney(summaryText);
  if (!(landed > 0)) fail(`Custo posto permaneceu zerado após CIF USD 1000: ${landedText}`);
  if (!(suggested > landed)) fail(`Venda sugerida não superou o custo posto: custo=${landedText} sugerido=${suggestedText}`);
  if (!(summary > 0)) fail(`Resumo de custo posto permaneceu zerado: ${summaryText}`);

  const memory = await panel.textContent();
  for (const expected of ['PIS-Importação', 'COFINS-Importação', 'Terminal — procedimento operacional', 'Terminal — inspeção não invasiva', 'Terminal — movimentação / carregamento', 'Terminal — pesagem']) {
    if (!memory.includes(expected)) fail(`Linha obrigatória ausente da memória: ${expected}`);
  }

  const values = await page.evaluate(() => {
    const project = currentProject();
    const breakdown = conutwayV3AllBreakdown(project);
    return {
      profileId: project.costCatalogProfileId,
      profileVersion: project.costCatalogVersion,
      engineVersion: project.costEngineVersion,
      cifBrl: breakdown?.projectCifBrl || 0,
      landedTotal: breakdown?.landedTotal || 0,
      pis: breakdown?.itemTaxTotals?.pis || 0,
      cofins: breakdown?.itemTaxTotals?.cofins || 0,
      terminal: breakdown?.projectFees?.terminal?.total || 0,
      pending: breakdown?.pending || [],
      itemCalculation: project.items?.[0]?.detailedBreakdown || null,
    };
  });

  if (values.engineVersion !== 3 || values.profileId !== 'cost-rj-rio-brasil-2026-v3') fail(`Snapshot V3 inválido: ${JSON.stringify(values)}`);
  if (!(values.cifBrl > 0 && values.landedTotal > values.cifBrl)) fail(`Custos não foram somados ao CIF: ${JSON.stringify(values)}`);
  if (!(values.pis > 0 && values.cofins > 0 && values.terminal > 0)) fail(`Tributos/taxas esperados não foram calculados: ${JSON.stringify(values)}`);
  if (!values.itemCalculation || values.itemCalculation.version !== 3) fail(`Memória por item não foi armazenada: ${JSON.stringify(values.itemCalculation)}`);

  await page.locator('#saveProjectBtn').click();
  await page.waitForTimeout(500);
  const quoteNumber = await page.locator('#projectDetail [data-project-summary="quoteNumber"], #projectDetail .project-detail-number').first().textContent().catch(() => '');

  await page.screenshot({ path: 'pages-workspace-quotation-cost-engine-v3.png', fullPage: true });
  console.log(JSON.stringify({
    ok: true,
    profile: selectedText,
    landedUnitCostBrl: landed,
    suggestedSaleUnitBrl: suggested,
    landedSummaryBrl: summary,
    quoteNumber,
    values,
  }, null, 2));
} catch (error) {
  await page.screenshot({ path: 'pages-workspace-quotation-cost-engine-v3-error.png', fullPage: true }).catch(() => {});
  console.error(error?.stack || String(error));
  process.exitCode = 1;
} finally {
  await browser.close();
}

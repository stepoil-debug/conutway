import { chromium } from 'playwright';

const BASE = process.env.CONUTWAY_BASE_URL || 'https://stepoil-debug.github.io/conutway/';
const QA_NCM = '99000001';
const QA_FX = 5.1234;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
const page = await context.newPage();

const fail = (message) => { throw new Error(message); };
const number = (value) => Number(String(value ?? '').replace(',', '.')) || 0;
const parseMoney = (text = '') => {
  let raw = String(text).replace(/[^0-9,.-]/g, '');
  const comma = raw.lastIndexOf(',');
  const dot = raw.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) raw = comma > dot ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
  else if (comma >= 0) raw = raw.replace(',', '.');
  return Number(raw) || 0;
};

try {
  await page.goto(`${BASE}login.html`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill('admin');
  await page.locator('#submitBtn').click();
  await page.waitForURL((url) => url.pathname.endsWith('/conutway/') || url.pathname.endsWith('/conutway'), { timeout: 15000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 15000 });

  if (!(await page.locator('link[data-conutway-cost-engine="v3"]').count())) fail('CSS do motor V3 ausente.');
  if (!(await page.locator('link[data-conutway-ncm-tax-sync="v1"]').count())) fail('CSS da integração NCM ausente.');
  if (!(await page.locator('link[data-conutway-live-fx="v1"]').count())) fail('CSS da atualização de câmbio ausente.');

  // 1) Cadastro fiscal do produto. O NCM QA é isolado do catálogo real para
  // testar o caso inequívoco; conflitos reais permanecem como pendência.
  await page.locator('.module-nav button[data-module-target="products"]').click();
  await page.locator('#products').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#newProductBtn').click();
  for (const field of ['iiRate','pisImportRate','cofinsImportRate','icmsExtraBaseBrl']) {
    if (!(await page.locator(`[data-product-field="${field}"]`).count())) fail(`Campo fiscal do produto ausente: ${field}`);
  }

  const valuesToFill = {
    ctCode: 'CT-9901',
    ncm: QA_NCM,
    descriptionPt: 'Produto QA tributação por NCM',
    uom: 'UN',
    cifUnitPrice: '1000',
    iiRate: '14',
    ipiRate: '5',
    pisImportRate: '2.1',
    cofinsImportRate: '9.65',
    icmsRate: '20',
    icmsExtraBaseBrl: '0',
  };
  for (const [field, value] of Object.entries(valuesToFill)) {
    await page.locator(`[data-product-field="${field}"]`).fill(value);
  }
  await page.locator('#saveProductBtn').click();
  await page.waitForTimeout(600);

  const savedProduct = await page.evaluate((qaNcm) => {
    const product = state.products.find((item) => item.ctCode === 'CT-9901');
    return product ? {
      id: product.id, ctCode: product.ctCode, ncm: product.ncm,
      expectedNcm: qaNcm,
      iiRate: product.iiRate, ipiRate: product.ipiRate,
      pisImportRate: product.pisImportRate, cofinsImportRate: product.cofinsImportRate,
      icmsRate: product.icmsRate,
    } : null;
  }, QA_NCM);
  if (!savedProduct) fail('Produto QA não foi salvo.');
  if (savedProduct.ncm !== QA_NCM || number(savedProduct.iiRate) !== 14 || number(savedProduct.icmsRate) !== 20) {
    fail(`Cadastro fiscal do produto incorreto: ${JSON.stringify(savedProduct)}`);
  }

  // 2) Cotação deve herdar o produto inteiro e a regra fiscal automaticamente.
  await page.locator('.module-nav button[data-module-target="projects"]').click();
  await page.locator('#projects').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#newProjectBtn').click();
  await page.locator('#projectDetail').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('[data-project-view="pricing"]').click();
  await page.locator('[data-project-panel="pricing"]').waitFor({ state: 'visible', timeout: 10000 });

  const profile = page.locator('#quoteCostProfileSelect');
  await profile.waitFor({ state: 'visible', timeout: 10000 });
  if (await profile.inputValue() !== 'cost-rj-rio-brasil-2026-v3') fail('Perfil oficial não foi aplicado automaticamente.');

  const liveFxButton = page.locator('[data-live-fx-refresh]');
  await liveFxButton.waitFor({ state: 'visible', timeout: 10000 });

  const ct = page.locator('[data-item-field="ctCode"]').first();
  await ct.fill('CT-9901');
  await ct.dispatchEvent('change');
  await page.waitForTimeout(500);

  const inheritedNcm = await page.locator('[data-item-field="ncm"]').first().inputValue();
  if (inheritedNcm !== QA_NCM) fail(`NCM não foi herdado do produto: ${inheritedNcm}`);

  const expectedRates = { iiRate: 14, ipiRate: 5, pisImportRate: 2.1, cofinsImportRate: 9.65, icmsRate: 20 };
  for (const [field, expected] of Object.entries(expectedRates)) {
    const actual = number(await page.locator(`[data-v3-item-field="${field}"]`).first().inputValue());
    if (Math.abs(actual - expected) > 0.001) fail(`${field} não veio do cadastro/NCM: ${actual} != ${expected}`);
  }

  const sourceText = await page.locator('.ncm-tax-source').first().textContent();
  if (!String(sourceText).includes('Cadastro do produto')) fail(`Origem fiscal incorreta: ${sourceText}`);

  const landedText = await page.locator('[data-cost-output="landedUnitCostBrl"]').first().textContent();
  const suggestedText = await page.locator('[data-suggested-price-value]').first().textContent();
  const landed = parseMoney(landedText);
  const suggested = parseMoney(suggestedText);
  if (!(landed > 10000)) fail(`Custo posto não incorporou tributação do produto: ${landedText}`);
  if (!(suggested > landed)) fail(`Venda sugerida inválida: custo=${landedText} venda=${suggestedText}`);

  const flow = await page.evaluate(() => {
    const project = currentProject();
    const item = project.items[0];
    const taxes = project.detailedCostEngine?.itemTaxes?.[item.id] || {};
    const breakdown = conutwayV3AllBreakdown(project);
    return {
      item: { productId: item.productId, ctCode: item.ctCode, ncm: item.ncm, ipiRate: item.ipiRate, icmsRate: item.icmsRate, fiscalSource: item.fiscalSource },
      taxes,
      totals: {
        cifBrl: breakdown.projectCifBrl,
        ii: breakdown.itemTaxTotals.ii,
        ipi: breakdown.itemTaxTotals.ipi,
        pis: breakdown.itemTaxTotals.pis,
        cofins: breakdown.itemTaxTotals.cofins,
        icms: breakdown.itemTaxTotals.icms,
        terminal: breakdown.projectFees.terminal.total,
        landed: breakdown.landedTotal,
      },
    };
  });
  if (!flow.item.productId || flow.taxes._source !== 'product') fail(`Vínculo produto/fiscal não persistiu: ${JSON.stringify(flow)}`);
  if (!(flow.totals.ii > 0 && flow.totals.ipi > 0 && flow.totals.pis > 0 && flow.totals.cofins > 0 && flow.totals.icms > 0)) {
    fail(`Tributos não entraram no cálculo: ${JSON.stringify(flow.totals)}`);
  }

  // 3) Atualização do câmbio sob demanda deve usar a venda PTAX, preservar o
  // buffer comercial e recalcular o orçamento imediatamente. O fetch é isolado
  // dentro do navegador para testar o fluxo do botão sem depender da rede externa.
  await page.evaluate((qaFx) => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = String(input?.url || input || '');
      if (url.startsWith('https://olinda.bcb.gov.br/')) {
        return new Response(JSON.stringify({
          value: [{
            cotacaoCompra: qaFx - 0.0006,
            cotacaoVenda: qaFx,
            dataHoraCotacao: '2026-08-11T13:10:00.000-03:00',
          }],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return nativeFetch(input, init);
    };
  }, QA_FX);

  await liveFxButton.click();
  await page.waitForFunction((expected) => {
    const project = currentProject();
    return Math.abs(Number(project.liveFx?.rate || 0) - expected) < 0.000001;
  }, QA_FX, { timeout: 10000 });

  const liveFx = await page.evaluate(() => {
    const project = currentProject();
    const formula = conutwayV3Formula(project);
    const breakdown = conutwayV3AllBreakdown(project);
    return {
      rate: Number(formula.fxRate || 0),
      effective: conutwayV3EffectiveFx(formula),
      sourceCode: project.liveFx?.sourceCode,
      source: project.liveFx?.source,
      quotedAt: project.liveFx?.quotedAt,
      cifBrl: breakdown.projectCifBrl,
    };
  });
  if (Math.abs(liveFx.rate - QA_FX) > 0.000001) fail(`PTAX não foi aplicada ao snapshot: ${JSON.stringify(liveFx)}`);
  if (liveFx.sourceCode !== 'bcb-ptax-usd-brl-sale') fail(`Fonte PTAX não foi auditada: ${JSON.stringify(liveFx)}`);
  const expectedEffective = QA_FX * 1.03;
  if (Math.abs(liveFx.effective - expectedEffective) > 0.000001) fail(`Buffer cambial não foi preservado: ${JSON.stringify(liveFx)}`);
  if (Math.abs(liveFx.cifBrl - expectedEffective * 1000) > 0.05) fail(`CIF não foi recalculado com PTAX: ${JSON.stringify(liveFx)}`);
  const liveFxSourceText = await page.locator('[data-live-fx-source]').textContent();
  if (!String(liveFxSourceText).includes('Banco Central')) fail(`Fonte visual do câmbio incorreta: ${liveFxSourceText}`);

  // 4) Uma regra fiscal inequívoca do mesmo NCM pode ser reaproveitada sem
  // transformar o segundo item no produto que originou a regra.
  await page.locator('#addItemBtn').click();
  await page.locator('[data-item-field="descriptionPt"]').nth(1).fill('Outro produto com o mesmo NCM');
  const secondNcm = page.locator('[data-item-field="ncm"]').nth(1);
  await secondNcm.fill(QA_NCM);
  await secondNcm.dispatchEvent('change');
  await page.waitForTimeout(500);

  const secondIdentity = await page.evaluate(() => {
    const project = currentProject();
    const item = project.items[1];
    conutwayV3ItemTaxConfig(project, item);
    const taxes = project.detailedCostEngine?.itemTaxes?.[item.id] || {};
    return { ctCode: item.ctCode, descriptionPt: item.descriptionPt, ncm: item.ncm, source: taxes._source, iiRate: taxes.iiRate, icmsRate: taxes.icmsRate };
  });
  if (secondIdentity.ctCode === 'CT-9901') fail(`NCM alterou indevidamente a identidade do segundo produto: ${JSON.stringify(secondIdentity)}`);
  if (secondIdentity.descriptionPt !== 'Outro produto com o mesmo NCM') fail(`Descrição do segundo produto foi alterada: ${JSON.stringify(secondIdentity)}`);
  if (secondIdentity.source !== 'ncm' || number(secondIdentity.iiRate) !== 14 || number(secondIdentity.icmsRate) !== 20) {
    fail(`Regra fiscal por NCM não foi reaproveitada: ${JSON.stringify(secondIdentity)}`);
  }

  await page.screenshot({ path: 'pages-workspace-quotation-cost-engine-v3.png', fullPage: true });
  console.log(JSON.stringify({
    ok: true,
    flow: 'Produto -> NCM -> tributos -> PTAX -> custo posto',
    qaNcm: QA_NCM,
    savedProduct,
    landedUnitCostBrl: landed,
    suggestedSaleUnitBrl: suggested,
    taxFlow: flow,
    liveFx,
    secondIdentity,
  }, null, 2));
} catch (error) {
  await page.screenshot({ path: 'pages-workspace-quotation-cost-engine-v3-error.png', fullPage: true }).catch(() => {});
  console.error(error?.stack || String(error));
  process.exitCode = 1;
} finally {
  await browser.close();
}

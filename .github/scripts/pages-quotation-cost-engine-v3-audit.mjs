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

page.on('console', (message) => {
  const text = message.text();
  if (message.type() === 'error' || text.includes('conutway_live_fx')) {
    console.log('BROWSER_CONSOLE', message.type(), text);
  }
});
page.on('pageerror', (error) => console.log('BROWSER_PAGE_ERROR', error?.stack || error?.message || String(error)));

try {
  await page.goto(`${BASE}login.html`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill('admin');
  await page.locator('#submitBtn').click();
  await page.waitForURL((url) => url.pathname.endsWith('/conutway/') || url.pathname.endsWith('/conutway'), { timeout: 15000 });
  await page.locator('.app-shell').waitFor({ state: 'visible', timeout: 15000 });

  for (const selector of [
    'link[data-conutway-cost-engine="v3"]',
    'link[data-conutway-ncm-tax-sync="v1"]',
    'link[data-conutway-live-fx="v1"]',
  ]) {
    if (!(await page.locator(selector).count())) fail(`Integração ausente: ${selector}`);
  }

  // Cadastro fiscal completo do produto.
  await page.locator('.module-nav button[data-module-target="products"]').click();
  await page.locator('#products').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#newProductBtn').click();
  for (const field of ['iiRate','pisImportRate','cofinsImportRate','icmsExtraBaseBrl']) {
    if (!(await page.locator(`[data-product-field="${field}"]`).count())) fail(`Campo fiscal ausente: ${field}`);
  }
  const productValues = {
    ctCode: 'CT-9901', ncm: QA_NCM, descriptionPt: 'Produto QA tributação por NCM', uom: 'UN',
    cifUnitPrice: '1000', iiRate: '14', ipiRate: '5', pisImportRate: '2.1', cofinsImportRate: '9.65',
    icmsRate: '20', icmsExtraBaseBrl: '0',
  };
  for (const [field, value] of Object.entries(productValues)) {
    await page.locator(`[data-product-field="${field}"]`).fill(value);
  }
  await page.locator('#saveProductBtn').click();
  await page.waitForTimeout(500);

  const savedProduct = await page.evaluate((qaNcm) => {
    const product = state.products.find((item) => item.ctCode === 'CT-9901');
    return product ? {
      id: product.id, ctCode: product.ctCode, ncm: product.ncm, expectedNcm: qaNcm,
      iiRate: product.iiRate, ipiRate: product.ipiRate, pisImportRate: product.pisImportRate,
      cofinsImportRate: product.cofinsImportRate, icmsRate: product.icmsRate,
    } : null;
  }, QA_NCM);
  if (!savedProduct || savedProduct.ncm !== QA_NCM || number(savedProduct.iiRate) !== 14) {
    fail(`Produto fiscal não foi salvo corretamente: ${JSON.stringify(savedProduct)}`);
  }

  // Nova cotação + produto selecionado.
  await page.locator('.module-nav button[data-module-target="projects"]').click();
  await page.locator('#newProjectBtn').click();
  await page.locator('#projectDetail').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('[data-project-view="pricing"]').click();
  await page.locator('[data-project-panel="pricing"]').waitFor({ state: 'visible', timeout: 10000 });
  const profile = page.locator('#quoteCostProfileSelect');
  await profile.waitFor({ state: 'visible', timeout: 10000 });
  if (await profile.inputValue() !== 'cost-rj-rio-brasil-2026-v3') fail('Perfil oficial não foi aplicado automaticamente.');

  const ct = page.locator('[data-item-field="ctCode"]').first();
  await ct.fill('CT-9901');
  await ct.dispatchEvent('change');
  await page.waitForTimeout(500);
  if (await page.locator('[data-item-field="ncm"]').first().inputValue() !== QA_NCM) fail('NCM não foi herdado do produto.');

  for (const [field, expected] of Object.entries({ iiRate: 14, ipiRate: 5, pisImportRate: 2.1, cofinsImportRate: 9.65, icmsRate: 20 })) {
    const actual = number(await page.locator(`[data-v3-item-field="${field}"]`).first().inputValue());
    if (Math.abs(actual - expected) > 0.001) fail(`${field} não veio do produto/NCM: ${actual}`);
  }

  const landedBefore = parseMoney(await page.locator('[data-cost-output="landedUnitCostBrl"]').first().textContent());
  if (!(landedBefore > 10000)) fail(`Custo posto inicial inválido: ${landedBefore}`);

  // Mock determinístico apenas para o domínio do provedor, mantendo o mesmo
  // contrato de resposta que a função de produção consome.
  await page.evaluate((qaFx) => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = String(input?.url || input || '');
      if (url.startsWith('https://olinda.bcb.gov.br/')) {
        return new Response(JSON.stringify({ value: [{
          cotacaoCompra: qaFx - 0.0006,
          cotacaoVenda: qaFx,
          dataHoraCotacao: '2026-08-11T13:10:00.000-03:00',
        }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return nativeFetch(input, init);
    };
  }, QA_FX);

  // Diagnóstico 1: a função de consulta isolada precisa interpretar a resposta.
  const fetchDiag = await page.evaluate(async () => {
    try {
      const fx = await conutwayLiveFxFetchBcbLatest();
      return { ok: true, fx };
    } catch (error) {
      return { ok: false, message: error?.message, stack: error?.stack };
    }
  });
  console.log('LIVE_FX_FETCH_DIAG', JSON.stringify(fetchDiag));
  if (!fetchDiag.ok || Math.abs(number(fetchDiag.fx?.rate) - QA_FX) > 0.000001) {
    fail(`Consulta de câmbio falhou: ${JSON.stringify(fetchDiag)}`);
  }

  // Diagnóstico 2: confirma que o clique realmente chega à função de atualização.
  await page.evaluate(() => {
    window.__liveFxQaCalls = 0;
    const original = conutwayLiveFxRefresh;
    conutwayLiveFxRefresh = async function conutwayLiveFxRefreshQa(button) {
      window.__liveFxQaCalls += 1;
      return original(button);
    };
  });

  const liveFxButton = page.locator('[data-live-fx-refresh]');
  await liveFxButton.waitFor({ state: 'visible', timeout: 10000 });
  await liveFxButton.click();
  await page.waitForTimeout(1200);

  const clickDiag = await page.evaluate(() => {
    const project = currentProject();
    const button = document.querySelector('[data-live-fx-refresh]');
    return {
      calls: window.__liveFxQaCalls || 0,
      buttonText: button?.textContent || '',
      buttonTitle: button?.title || '',
      buttonDisabled: Boolean(button?.disabled),
      liveFx: project.liveFx || null,
      projectFx: project.formulaSnapshot?.fxRate ?? project.costProfileSnapshot?.fxRate ?? null,
      itemFx: project.items?.[0]?.formulaSnapshot?.fxRate ?? project.items?.[0]?.costProfileSnapshot?.fxRate ?? null,
    };
  });
  console.log('LIVE_FX_CLICK_DIAG', JSON.stringify(clickDiag));
  if (clickDiag.calls < 1) fail(`Clique não chamou atualização: ${JSON.stringify(clickDiag)}`);
  if (Math.abs(number(clickDiag.liveFx?.rate) - QA_FX) > 0.000001) fail(`Câmbio não foi aplicado: ${JSON.stringify(clickDiag)}`);

  const liveFx = await page.evaluate(() => {
    const project = currentProject();
    const formula = conutwayV3Formula(project);
    const breakdown = conutwayV3AllBreakdown(project);
    return {
      rate: Number(formula.fxRate || 0), effective: conutwayV3EffectiveFx(formula),
      sourceCode: project.liveFx?.sourceCode, source: project.liveFx?.source, quotedAt: project.liveFx?.quotedAt,
      cifBrl: breakdown.projectCifBrl, landed: breakdown.landedTotal,
      projectSnapshotFx: project.formulaSnapshot?.fxRate ?? null,
      itemSnapshotFx: project.items?.[0]?.formulaSnapshot?.fxRate ?? null,
    };
  });
  const expectedEffective = QA_FX * 1.03;
  if (Math.abs(liveFx.rate - QA_FX) > 0.000001) fail(`Taxa efetiva do perfil não atualizou: ${JSON.stringify(liveFx)}`);
  if (Math.abs(liveFx.effective - expectedEffective) > 0.000001) fail(`Buffer de 3% não foi preservado: ${JSON.stringify(liveFx)}`);
  if (Math.abs(liveFx.cifBrl - expectedEffective * 1000) > 0.05) fail(`CIF não recalculou: ${JSON.stringify(liveFx)}`);
  if (liveFx.sourceCode !== 'bcb-ptax-usd-brl-sale') fail(`Auditoria da fonte ausente: ${JSON.stringify(liveFx)}`);
  if (!String(await page.locator('[data-live-fx-source]').textContent()).includes('Banco Central')) fail('Fonte visual do câmbio não foi exibida.');

  // Mesmo NCM inequívoco reaproveita somente a regra fiscal, sem trocar identidade.
  await page.locator('#addItemBtn').click();
  await page.locator('[data-item-field="descriptionPt"]').nth(1).fill('Outro produto com o mesmo NCM');
  const secondNcm = page.locator('[data-item-field="ncm"]').nth(1);
  await secondNcm.fill(QA_NCM);
  await secondNcm.dispatchEvent('change');
  await page.waitForTimeout(400);
  const second = await page.evaluate(() => {
    const project = currentProject();
    const item = project.items[1];
    conutwayV3ItemTaxConfig(project, item);
    const taxes = project.detailedCostEngine?.itemTaxes?.[item.id] || {};
    return { ctCode: item.ctCode, descriptionPt: item.descriptionPt, source: taxes._source, iiRate: taxes.iiRate };
  });
  if (second.ctCode === 'CT-9901' || second.descriptionPt !== 'Outro produto com o mesmo NCM' || second.source !== 'ncm' || number(second.iiRate) !== 14) {
    fail(`Reaproveitamento por NCM incorreto: ${JSON.stringify(second)}`);
  }

  await page.screenshot({ path: 'pages-workspace-quotation-cost-engine-v3.png', fullPage: true });
  console.log(JSON.stringify({ ok: true, flow: 'Produto -> NCM -> tributos -> câmbio atualizado -> custo posto', savedProduct, landedBefore, liveFx, second }, null, 2));
} catch (error) {
  await page.screenshot({ path: 'pages-workspace-quotation-cost-engine-v3-error.png', fullPage: true }).catch(() => {});
  console.error(error?.stack || String(error));
  process.exitCode = 1;
} finally {
  await browser.close();
}

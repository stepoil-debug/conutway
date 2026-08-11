/* CONUTWAY QUOTATION NCM TAX SYNC V1
   Produto/CT Code -> NCM -> regra fiscal -> tributação da cotação.
   Não inventa alíquotas: prioriza cadastro do produto/NCM e mantém pendências explícitas. */

const CONUTWAY_NCM_TAX_SYNC_VERSION = 1;

function conutwayNcmDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function conutwayNcmKey(value) {
  const digits = conutwayNcmDigits(value);
  // NCM brasileiro possui 8 dígitos. Registros legados do ERP podem conter
  // códigos maiores; usamos somente os 8 primeiros para associação, sem
  // alterar silenciosamente o valor salvo no cadastro.
  return digits.length >= 8 ? digits.slice(0, 8) : digits;
}

function conutwayNcmIsCanonical(value) {
  return conutwayNcmDigits(value).length === 8;
}

function conutwayNcmMaybeNumber(value, fallback = null) {
  if (value === '' || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function conutwayNcmProductFiscalProfile(product = {}, defaults = {}) {
  const explicit = (field, fallback) => {
    const value = conutwayNcmMaybeNumber(product[field], null);
    return value === null ? fallback : value;
  };
  return {
    iiRate: explicit('iiRate', conutwayNcmMaybeNumber(defaults.iiRate, 0) ?? 0),
    ipiRate: explicit('ipiRate', conutwayNcmMaybeNumber(defaults.ipiRate, 0) ?? 0),
    pisImportRate: explicit('pisImportRate', conutwayNcmMaybeNumber(defaults.pisImportRate, 0) ?? 0),
    cofinsImportRate: explicit('cofinsImportRate', conutwayNcmMaybeNumber(defaults.cofinsImportRate, 0) ?? 0),
    icmsRate: explicit('icmsRate', conutwayNcmMaybeNumber(defaults.icmsRate, 0) ?? 0),
    icmsExtraBaseBrl: explicit('icmsExtraBaseBrl', conutwayNcmMaybeNumber(defaults.icmsExtraBaseBrl, 0) ?? 0),
  };
}

function conutwayNcmFiscalSignature(profile = {}) {
  return ['iiRate','ipiRate','pisImportRate','cofinsImportRate','icmsRate','icmsExtraBaseBrl']
    .map((field) => Number(profile[field] || 0).toFixed(6)).join('|');
}

function conutwayNcmExactProduct(item = {}) {
  const productId = String(item.productId || '').trim();
  if (productId) {
    const byId = (state.products || []).find((product) => String(product.id || '').trim() === productId);
    if (byId) return byId;
  }
  const ctCode = String(item.ctCode || '').trim().toLowerCase();
  if (ctCode) {
    const byCode = (state.products || []).find((product) => String(product.ctCode || '').trim().toLowerCase() === ctCode);
    if (byCode) return byCode;
  }
  return null;
}

function conutwayNcmProductsForCode(ncm) {
  const key = conutwayNcmKey(ncm);
  if (key.length !== 8) return [];
  return (state.products || []).filter((product) => conutwayNcmKey(product.ncm) === key);
}

function conutwayNcmResolveProduct(item = {}) {
  const exact = conutwayNcmExactProduct(item);
  if (exact) return { product: exact, source: 'product', ambiguous: false };

  const candidates = conutwayNcmProductsForCode(item.ncm);
  if (!candidates.length) return { product: null, source: 'pending', ambiguous: false };
  if (candidates.length === 1) return { product: candidates[0], source: 'ncm', ambiguous: false };

  const config = conutwayV3Config(currentProject()) || {};
  const defaults = config.defaultItemTaxes || {};
  const signatures = new Set(candidates.map((product) => conutwayNcmFiscalSignature(conutwayNcmProductFiscalProfile(product, defaults))));
  if (signatures.size === 1) return { product: candidates[0], source: 'ncm', ambiguous: false };
  return { product: null, source: 'ambiguous', ambiguous: true };
}

function conutwayNcmTaxSourceLabel(source) {
  return ({
    product: 'Cadastro do produto',
    ncm: 'Regra do NCM',
    manual: 'Ajuste manual',
    profile: 'Perfil padrão',
    ambiguous: 'NCM com conflito',
    pending: 'Tributação pendente',
  })[source] || 'Perfil padrão';
}

function conutwayNcmApplyFiscalProfile(project, item, product, options = {}) {
  const config = conutwayV3Config(project);
  if (!config || !item || !product) return false;
  config.itemTaxes ||= {};
  const defaults = config.defaultItemTaxes || {};
  const profile = conutwayNcmProductFiscalProfile(product, defaults);
  const previous = config.itemTaxes[item.id] || {};
  const force = Boolean(options.force);
  if (!force && previous._source === 'manual') return false;

  item.productId = String(product.id || item.productId || '').trim();
  if (product.ctCode) item.ctCode = product.ctCode;
  if (product.ncm) item.ncm = product.ncm;
  item.ipiRate = profile.ipiRate;
  item.icmsRate = profile.icmsRate;

  config.itemTaxes[item.id] = {
    ...profile,
    _source: options.source || 'product',
    _productId: String(product.id || ''),
    _ctCode: String(product.ctCode || ''),
    _ncm: conutwayNcmKey(product.ncm || item.ncm),
    _syncedAt: new Date().toISOString(),
  };
  item.fiscalSource = config.itemTaxes[item.id]._source;
  item.fiscalNcmKey = config.itemTaxes[item.id]._ncm;
  return true;
}

function conutwayNcmSyncItem(project, item, options = {}) {
  if (!item || !conutwayV3Config(project)) return { source: 'pending', changed: false };
  const saved = project.detailedCostEngine.itemTaxes?.[item.id] || {};
  if (!options.force && saved._source === 'manual') return { source: 'manual', changed: false };

  const resolved = conutwayNcmResolveProduct(item);
  if (resolved.product) {
    const currentKey = conutwayNcmKey(item.ncm || resolved.product.ncm);
    const sameBinding = saved._productId === String(resolved.product.id || '') && saved._ncm === currentKey;
    const changed = (!sameBinding || options.force)
      ? conutwayNcmApplyFiscalProfile(project, item, resolved.product, { force: options.force, source: resolved.source })
      : false;
    return { ...resolved, changed };
  }

  item.fiscalSource = resolved.source;
  item.fiscalNcmKey = conutwayNcmKey(item.ncm);
  return { ...resolved, changed: false };
}

function conutwayNcmSyncProject(project = currentProject()) {
  if (!project?.items || !conutwayV3Config(project)) return;
  project.items.forEach((item) => conutwayNcmSyncItem(project, item));
}

/* O cadastro antigo já tinha IPI/ICMS. Acrescentamos os campos faltantes para
   que o produto carregue o perfil fiscal completo usado pela cotação. */
const conutwayNcmLegacyBlankProduct = blankProduct;
blankProduct = function conutwayNcmBlankProduct() {
  return {
    ...conutwayNcmLegacyBlankProduct(),
    iiRate: 0,
    pisImportRate: 2.1,
    cofinsImportRate: 9.65,
    icmsExtraBaseBrl: 0,
  };
};

function conutwayNcmEnsureProductFiscalFields() {
  const section = document.querySelector('#products .form-section-brl-price');
  const grid = section?.querySelector('.form-grid');
  if (!section || !grid || grid.dataset.ncmTaxFields === 'v1') return;
  grid.dataset.ncmTaxFields = 'v1';

  const heading = section.querySelector('.subsection-title');
  if (heading) heading.textContent = 'Tributação e preço Brasil — por NCM';

  const unitPrice = grid.querySelector('[data-product-field="unitPriceWithoutIpi"]')?.closest('label');
  const ii = document.createElement('label');
  ii.innerHTML = 'II %<input data-product-field="iiRate" type="number" min="0" step="0.01"><small>Imposto de Importação associado ao NCM/produto.</small>';
  const pis = document.createElement('label');
  pis.innerHTML = 'PIS-Importação %<input data-product-field="pisImportRate" type="number" min="0" step="0.01"><small>Alíquota efetiva do produto/operação.</small>';
  const cofins = document.createElement('label');
  cofins.innerHTML = 'COFINS-Importação %<input data-product-field="cofinsImportRate" type="number" min="0" step="0.01"><small>Alíquota efetiva do produto/operação.</small>';
  const extra = document.createElement('label');
  extra.innerHTML = 'Base extra ICMS (BRL)<input data-product-field="icmsExtraBaseBrl" type="number" min="0" step="0.01"><small>Frete/despesas que integrem a base, quando aplicável.</small>';

  if (unitPrice) unitPrice.insertAdjacentElement('afterend', ii);
  else grid.prepend(ii);
  grid.append(pis, cofins, extra);

  const hint = document.createElement('div');
  hint.className = 'ncm-tax-product-hint';
  hint.innerHTML = '<strong>Origem fiscal da cotação</strong><span>Ao selecionar este CT CODE na cotação, o NCM e estas alíquotas são carregados automaticamente. Se algum tributo não estiver definido, ele permanece como pendência — não vira zero silencioso.</span>';
  section.appendChild(hint);
}

/* Corrige o bug-base: a versão original preservava IPI/ICMS antigos do item. */
const conutwayNcmLegacyApplyProductToItem = applyProductToItem;
applyProductToItem = function conutwayNcmApplyProductToItem(index, code) {
  conutwayNcmLegacyApplyProductToItem(index, code);
  const project = currentProject();
  const item = project.items?.[index];
  const product = productByCtCode(code);
  if (!item || !product) return;
  conutwayNcmApplyFiscalProfile(project, item, product, { force: true, source: 'product' });
};

/* Antes de desenhar a cotação, sincroniza produtos já selecionados. Isso
   corrige inclusive cotações existentes sem exigir selecionar o CT CODE de novo. */
const conutwayNcmLegacyRenderItemsEditor = renderItemsEditor;
renderItemsEditor = function conutwayNcmRenderItemsEditor() {
  conutwayNcmSyncProject(currentProject());
  const result = conutwayNcmLegacyRenderItemsEditor();
  conutwayNcmDecorateTaxPanel(currentProject());
  return result;
};

const conutwayNcmLegacyRenderProducts = renderProducts;
renderProducts = function conutwayNcmRenderProducts() {
  conutwayNcmEnsureProductFiscalFields();
  const result = conutwayNcmLegacyRenderProducts();
  // renderProducts chama fillFields; como os campos foram criados antes,
  // também recebem os valores do registro selecionado.
  return result;
};

function conutwayNcmDecorateTaxPanel(project = currentProject()) {
  const panel = document.querySelector('#quotationDetailedCostPanel');
  if (!panel) return;
  const title = panel.querySelector('.v3-tax-section .v3-section-title p');
  if (title) title.textContent = 'Selecione o CT CODE: o ERP herda NCM e tributação do cadastro do produto. O NCM também reaproveita uma regra fiscal já cadastrada para o mesmo código. Ajustes manuais ficam identificados.';

  const rows = [...panel.querySelectorAll('.v3-tax-table tbody tr')];
  rows.forEach((row, index) => {
    const item = project.items?.[index];
    if (!item) return;
    const saved = project.detailedCostEngine?.itemTaxes?.[item.id] || {};
    const source = saved._source || item.fiscalSource || (conutwayNcmKey(item.ncm).length === 8 ? 'profile' : 'pending');
    const firstCell = row.querySelector('td:first-child');
    if (!firstCell || firstCell.querySelector('.ncm-tax-source')) return;
    const badge = document.createElement('span');
    badge.className = `ncm-tax-source source-${source}`;
    badge.textContent = conutwayNcmTaxSourceLabel(source);
    firstCell.appendChild(badge);
    if (item.ncm && !conutwayNcmIsCanonical(item.ncm)) {
      const warning = document.createElement('small');
      warning.className = 'ncm-format-warning';
      warning.textContent = `NCM salvo com ${conutwayNcmDigits(item.ncm).length} dígitos; regra associada pela chave ${conutwayNcmKey(item.ncm) || 'inválida'}. Revise o cadastro.`;
      firstCell.appendChild(warning);
    }
  });
}

/* Quando NCM é alterado diretamente na cotação, procura a regra do mesmo NCM.
   Quando uma alíquota é editada na memória, marca a origem como manual. */
document.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  if (target.dataset.itemField === 'ncm') {
    const row = target.closest('[data-item-index]');
    const index = Number(row?.dataset.itemIndex);
    const project = currentProject();
    const item = Number.isInteger(index) ? project.items?.[index] : null;
    if (item) {
      const resolved = conutwayNcmSyncItem(project, item, { force: true });
      if (!resolved.product) {
        project.detailedCostEngine.itemTaxes ||= {};
        delete project.detailedCostEngine.itemTaxes[item.id];
        item.fiscalSource = resolved.ambiguous ? 'ambiguous' : 'pending';
      }
      queueMicrotask(() => {
        renderItemsEditor();
        renderQuote();
      });
    }
  }

  if (target.dataset.v3ItemField) {
    const itemId = String(target.dataset.v3ItemId || '');
    const project = currentProject();
    const rule = project.detailedCostEngine?.itemTaxes?.[itemId];
    if (rule) {
      rule._source = 'manual';
      rule._manualAt = new Date().toISOString();
      const item = project.items?.find((candidate) => candidate.id === itemId);
      if (item) item.fiscalSource = 'manual';
      queueMicrotask(() => conutwayNcmDecorateTaxPanel(project));
    }
  }
});

/* Novas pendências: NCM ausente/fora do padrão e conflito entre produtos com o
   mesmo NCM. Mantemos o modelo V3 original e apenas acrescentamos contexto. */
const conutwayNcmLegacyReadiness = quotationReadinessModel;
quotationReadinessModel = function conutwayNcmReadiness(project = currentProject()) {
  const model = conutwayNcmLegacyReadiness(project);
  (project.items || []).forEach((item) => {
    const hasBusinessData = Boolean(String(item.ctCode || '').trim() || String(item.descriptionPt || '').trim() || Number(item.cifUnitPrice || 0) > 0);
    if (!hasBusinessData) return;
    const key = conutwayNcmKey(item.ncm);
    if (key.length !== 8) {
      model.blocking.push({ label: `${item.ctCode || 'Item'} sem NCM válido`, detail: item.ncm || 'NCM não informado', view: 'pricing', target: '#quotationDetailedCostPanel' });
      return;
    }
    const resolved = conutwayNcmResolveProduct(item);
    if (resolved.ambiguous && project.detailedCostEngine?.itemTaxes?.[item.id]?._source !== 'manual') {
      model.warnings.push({ label: `${item.ctCode || key}: conflito de regra para NCM ${key}`, detail: 'Revisar tributação do item', view: 'pricing', target: '#quotationDetailedCostPanel' });
    }
  });
  return model;
};

/* Garante a existência dos campos antes da primeira renderização geral. */
conutwayNcmEnsureProductFiscalFields();

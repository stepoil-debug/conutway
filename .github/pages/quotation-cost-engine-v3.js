/* CONUTWAY QUOTATION COST ENGINE V3
   Motor detalhado e auditável de custos de importação.
   Injetado no app.js antes de init(). Mantém compatibilidade com o motor legado. */

const CONUTWAY_COST_ENGINE_VERSION = 3;
const CONUTWAY_COST_CATALOG_URL = 'assets/cost-catalog-v3.json';
let conutwayOfficialCostCatalog = { schemaVersion: 3, profiles: [] };

function conutwayV3Clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function conutwayV3Number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function conutwayV3Rate(value) {
  return Math.max(0, conutwayV3Number(value, 0)) / 100;
}

function conutwayV3Money(value) {
  return Math.max(0, conutwayV3Number(value, 0));
}

function conutwayV3Escape(value) {
  return typeof escapeHtml === 'function' ? escapeHtml(String(value ?? '')) : String(value ?? '');
}

function conutwayV3Input(value, digits = 2) {
  const number = conutwayV3Number(value, 0);
  return typeof BrErpFormatting !== 'undefined' && BrErpFormatting?.toInputFixed
    ? BrErpFormatting.toInputFixed(number, digits)
    : number.toFixed(digits);
}

function conutwayV3MoneyText(value) {
  return typeof moneyByCurrency === 'function'
    ? moneyByCurrency(conutwayV3Number(value, 0), 'BRL')
    : `R$ ${conutwayV3Number(value, 0).toFixed(2)}`;
}

function conutwayV3EffectiveFx(profile = {}) {
  const rate = Math.max(0, conutwayV3Number(profile.fxRate, 0));
  const buffer = Math.max(0, conutwayV3Number(profile.fxBufferRate, 0));
  return rate * (1 + buffer / 100);
}

function conutwayV3ProfileForProject(project = currentProject()) {
  const id = String(project.costCatalogProfileId || project.costProfileId || project.costProfileSnapshot?.id || '');
  return state.costProfiles.find((profile) => profile.id === id)
    || (state.quoteCostProfileDraft?.id === id ? state.quoteCostProfileDraft : null)
    || null;
}

function conutwayV3Config(project = currentProject()) {
  const config = project?.detailedCostEngine;
  return config?.enabled ? config : null;
}

function conutwayV3ItemTaxConfig(project, item) {
  const config = conutwayV3Config(project) || {};
  const defaults = config.defaultItemTaxes || {};
  const saved = config.itemTaxes?.[item.id] || {};
  return {
    iiRate: conutwayV3Number(saved.iiRate, conutwayV3Number(defaults.iiRate, 0)),
    ipiRate: conutwayV3Number(saved.ipiRate, conutwayV3Number(item.ipiRate, conutwayV3Number(defaults.ipiRate, 0))),
    pisImportRate: conutwayV3Number(saved.pisImportRate, conutwayV3Number(defaults.pisImportRate, 0)),
    cofinsImportRate: conutwayV3Number(saved.cofinsImportRate, conutwayV3Number(defaults.cofinsImportRate, 0)),
    icmsRate: conutwayV3Number(saved.icmsRate, conutwayV3Number(item.icmsRate, conutwayV3Number(defaults.icmsRate, 0))),
    icmsExtraBaseBrl: conutwayV3Money(saved.icmsExtraBaseBrl ?? defaults.icmsExtraBaseBrl),
  };
}

function conutwayV3Formula(project = currentProject()) {
  return project.formulaSnapshot || project.costProfileSnapshot || conutwayV3ProfileForProject(project) || {};
}

function conutwayV3CifItem(project, item) {
  const fx = conutwayV3EffectiveFx(conutwayV3Formula(project));
  const quantity = Math.max(0, conutwayV3Number(item.quantity, 0));
  const unitUsd = Math.max(0, conutwayV3Number(item.cifUnitPrice, 0));
  const unitBrl = unitUsd * fx;
  return { fx, quantity, unitUsd, unitBrl, totalBrl: unitBrl * quantity };
}

function conutwayV3ProjectCif(project = currentProject()) {
  return (project.items || []).reduce((sum, item) => sum + conutwayV3CifItem(project, item).totalBrl, 0);
}

function conutwayV3TerminalTotals(project, totalCifBrl) {
  const config = conutwayV3Config(project) || {};
  const catalog = config.terminalCatalog || {};
  if (!config.terminal || config.terminal === 'none' || !totalCifBrl) {
    return { procedure: 0, storage: 0, inspection: 0, handling: 0, weighing: 0, co2: 0, serviceTax: 0, total: 0, periods: 0, procedureStorageFactor: 1, serviceFactor: 1 };
  }
  const size = String(config.containerSize || '20') === '40' ? '40' : '20';
  const minKey = size === '40' ? 'min40' : 'min20';
  const procedureMin = size === '40' ? conutwayV3Money(catalog.procedureMin40) : conutwayV3Money(catalog.procedureMin20);
  const procedureBase = Math.max(totalCifBrl * conutwayV3Rate(catalog.procedureRate), procedureMin);
  const conditions = config.conditions || {};
  const surcharges = catalog.surcharges || {};
  const procedureStorageFactor = 1
    + (conditions.oog ? conutwayV3Rate(surcharges.oog) : 0)
    + (conditions.sanitary ? conutwayV3Rate(surcharges.sanitary) : 0)
    + (conditions.imo ? conutwayV3Rate(surcharges.imo) : 0)
    + (conditions.destuffedFcl ? conutwayV3Rate(surcharges.destuffedFcl) : 0)
    + (conditions.over40 ? conutwayV3Rate(surcharges.over40) : 0);
  const serviceFactor = 1 + (conditions.imo ? conutwayV3Rate(surcharges.imo) : 0);

  const terminalDays = Math.max(0, Math.floor(conutwayV3Number(config.daysAtTerminal, 5)));
  const storageDays = Math.max(0, terminalDays - 5);
  const periods = storageDays ? Math.ceil(storageDays / 6) : 0;
  const storagePeriods = Array.isArray(catalog.storagePeriods) ? catalog.storagePeriods : [];
  let storageBase = 0;
  for (let index = 0; index < periods; index += 1) {
    const period = storagePeriods[Math.min(index, Math.max(0, storagePeriods.length - 1))] || {};
    const minimum = conutwayV3Money(period[minKey]);
    storageBase += Math.max(totalCifBrl * conutwayV3Rate(period.rate), minimum);
  }

  const services = config.services || {};
  const procedure = procedureBase * procedureStorageFactor;
  const storage = storageBase * procedureStorageFactor;
  const inspection = services.inspection ? conutwayV3Money(catalog.inspectionBrl) * serviceFactor : 0;
  const handling = services.handling ? conutwayV3Money(catalog.handlingBrl) * serviceFactor : 0;
  const weighing = services.weighing ? conutwayV3Money(catalog.weighingBrl) * serviceFactor : 0;
  const co2 = services.co2 ? conutwayV3Money(catalog.co2Brl) * serviceFactor : 0;
  const taxableServices = procedure + storage + inspection + handling + weighing + co2;
  const serviceTax = taxableServices * conutwayV3Rate(config.terminalServiceTaxRate);
  return {
    procedure, storage, inspection, handling, weighing, co2, serviceTax,
    total: taxableServices + serviceTax,
    periods, procedureStorageFactor, serviceFactor,
  };
}

function conutwayV3ProjectFees(project, totalCifBrl) {
  const config = conutwayV3Config(project) || {};
  const fx = conutwayV3EffectiveFx(conutwayV3Formula(project));
  const freightBrl = conutwayV3Money(config.oceanFreightUsd) * fx;
  const afrmm = config.afrmmEnabled ? freightBrl * conutwayV3Rate(config.afrmmRate) : 0;
  const terminal = conutwayV3TerminalTotals(project, totalCifBrl);
  const fixed = {
    afrmm,
    siscomex: conutwayV3Money(config.siscomexBrl),
    customsBroker: conutwayV3Money(config.customsBrokerBrl),
    localLogistics: conutwayV3Money(config.localLogisticsBrl),
    demurrageDetention: conutwayV3Money(config.demurrageDetentionBrl),
    other: conutwayV3Money(config.otherBrl),
  };
  fixed.total = fixed.afrmm + fixed.siscomex + fixed.customsBroker + fixed.localLogistics + fixed.demurrageDetention + fixed.other + terminal.total;
  return { fx, freightBrl, terminal, fixed };
}

function conutwayV3ImportTaxValues(project, item) {
  const cif = conutwayV3CifItem(project, item);
  const taxes = conutwayV3ItemTaxConfig(project, item);
  const customsValue = cif.totalBrl;
  const ii = customsValue * conutwayV3Rate(taxes.iiRate);
  const ipiBase = customsValue + ii;
  const ipi = ipiBase * conutwayV3Rate(taxes.ipiRate);
  const pis = customsValue * conutwayV3Rate(taxes.pisImportRate);
  const cofins = customsValue * conutwayV3Rate(taxes.cofinsImportRate);
  const icmsPreGross = customsValue + ii + ipi + pis + cofins + conutwayV3Money(taxes.icmsExtraBaseBrl);
  const icmsRate = conutwayV3Rate(taxes.icmsRate);
  const icms = icmsRate > 0 && icmsRate < 1 ? (icmsPreGross / (1 - icmsRate)) * icmsRate : 0;
  const config = conutwayV3Config(project) || {};
  const cbsTest = customsValue * conutwayV3Rate(config.cbsTestRate);
  const ibsTest = customsValue * conutwayV3Rate(config.ibsTestRate);
  const transitionIncluded = Boolean(config.includeTransitionTaxes);
  const importTaxTotal = ii + ipi + pis + cofins + icms + (transitionIncluded ? cbsTest + ibsTest : 0);
  return { cif, taxes, customsValue, ii, ipiBase, ipi, pis, cofins, icmsPreGross, icms, cbsTest, ibsTest, transitionIncluded, importTaxTotal };
}

function conutwayV3DetailedCalculation(project, item, legacyCalculation = {}) {
  const config = conutwayV3Config(project);
  if (!config) return legacyCalculation;
  const taxes = conutwayV3ImportTaxValues(project, item);
  const projectCifBrl = conutwayV3ProjectCif(project);
  const share = projectCifBrl > 0 ? taxes.customsValue / projectCifBrl : 0;
  const projectFees = conutwayV3ProjectFees(project, projectCifBrl);
  const allocatedProjectFees = projectFees.fixed.total * share;
  const totalLanded = taxes.customsValue + taxes.importTaxTotal + allocatedProjectFees;
  const quantity = Math.max(0, taxes.cif.quantity);
  const landedUnitCostBrl = quantity > 0 ? totalLanded / quantity : 0;
  const formula = conutwayV3Formula(project);
  const salesTaxRate = formula.salesTaxEnabled === false ? 0 : conutwayV3Rate(formula.salesTaxRate);
  const profitRate = formula.profitEnabled === false ? 0 : conutwayV3Rate(formula.profitRate);
  const denominator = Math.max(0.000001, 1 - salesTaxRate);
  const calculatedSaleUnitPriceBrl = landedUnitCostBrl * (1 + profitRate) / denominator;
  const override = conutwayV3Money(item.manualSalePriceOverride);
  const manualOverrideApplied = override > 0;
  const saleUnitPriceBrl = manualOverrideApplied ? override : calculatedSaleUnitPriceBrl;
  const estimatedSalesTaxUnitBrl = saleUnitPriceBrl * salesTaxRate;
  const referenceNetProfitUnitBrl = saleUnitPriceBrl - landedUnitCostBrl - estimatedSalesTaxUnitBrl;
  const lineTotalBrl = saleUnitPriceBrl * quantity;
  const referenceNetProfitTotalBrl = referenceNetProfitUnitBrl * quantity;

  const detailedBreakdown = {
    version: CONUTWAY_COST_ENGINE_VERSION,
    calculatedAt: new Date().toISOString(),
    fxRate: taxes.cif.fx,
    customsValueBrl: taxes.customsValue,
    itemShare: share,
    taxes: {
      ii: taxes.ii, ipi: taxes.ipi, pisImport: taxes.pis, cofinsImport: taxes.cofins,
      icmsEstimate: taxes.icms, cbsTest: taxes.cbsTest, ibsTest: taxes.ibsTest,
      importTaxTotal: taxes.importTaxTotal,
    },
    rates: conutwayV3Clone(taxes.taxes),
    allocatedProjectFeesBrl: allocatedProjectFees,
    projectFeeTotalBrl: projectFees.fixed.total,
    landedTotalBrl: totalLanded,
    landedUnitCostBrl,
    saleUnitPriceBrl,
    salesTaxRate: salesTaxRate * 100,
    estimatedSalesTaxUnitBrl,
    referenceNetProfitUnitBrl,
  };

  return {
    ...legacyCalculation,
    effectiveFxRate: taxes.cif.fx,
    cifUnitBrl: taxes.cif.unitBrl,
    landedUnitCostBrl,
    calculatedSaleUnitPriceBrl,
    saleUnitPriceBrl,
    lineTotalBrl,
    costTotalBrl: totalLanded,
    salesTotalBrl: lineTotalBrl,
    estimatedSalesTaxUnitBrl,
    referenceNetProfitUnitBrl,
    referenceNetProfitTotalBrl,
    manualOverrideApplied,
    detailedBreakdown,
  };
}

function conutwayV3AllBreakdown(project = currentProject()) {
  const config = conutwayV3Config(project);
  if (!config) return null;
  const formula = conutwayV3Formula(project);
  const fx = conutwayV3EffectiveFx(formula);
  const projectCifBrl = conutwayV3ProjectCif(project);
  const projectFees = conutwayV3ProjectFees(project, projectCifBrl);
  const itemTaxTotals = { ii: 0, ipi: 0, pis: 0, cofins: 0, icms: 0, cbsTest: 0, ibsTest: 0, importTaxTotal: 0 };
  const itemRows = (project.items || []).map((item) => {
    const value = conutwayV3ImportTaxValues(project, item);
    itemTaxTotals.ii += value.ii;
    itemTaxTotals.ipi += value.ipi;
    itemTaxTotals.pis += value.pis;
    itemTaxTotals.cofins += value.cofins;
    itemTaxTotals.icms += value.icms;
    itemTaxTotals.cbsTest += value.cbsTest;
    itemTaxTotals.ibsTest += value.ibsTest;
    itemTaxTotals.importTaxTotal += value.importTaxTotal;
    return { item, value };
  });
  const landedTotal = projectCifBrl + itemTaxTotals.importTaxTotal + projectFees.fixed.total;
  const salesTaxRate = formula.salesTaxEnabled === false ? 0 : conutwayV3Rate(formula.salesTaxRate);
  const profitRate = formula.profitEnabled === false ? 0 : conutwayV3Rate(formula.profitRate);
  const commercialTotals = (project.items || []).reduce((acc, item) => {
    const calc = conutwayV3DetailedCalculation(project, item, {});
    const quantity = Math.max(0, conutwayV3Number(item.quantity, 0));
    acc.sales += conutwayV3Number(calc.lineTotalBrl, 0);
    acc.salesTax += conutwayV3Number(calc.estimatedSalesTaxUnitBrl, 0) * quantity;
    acc.profit += conutwayV3Number(calc.referenceNetProfitTotalBrl, 0);
    return acc;
  }, { sales: 0, salesTax: 0, profit: 0 });

  const rows = [];
  const add = (key, label, group, baseBrl, rateLabel, qtyPeriod, original, valueBrl, passedThrough = true, note = '') => rows.push({ key, label, group, baseBrl, rateLabel, qtyPeriod, original, fx, valueBrl, passedThrough, note });
  add('cif', 'Mercadoria / CIF', 'Base', projectCifBrl, '—', `${project.items?.length || 0} item(ns)`, 'USD', projectCifBrl, true, 'CIF informado nos itens.');
  add('ii', 'II — Imposto de Importação', 'Tributos importação', projectCifBrl, 'por item / NCM', 'itens', 'BRL', itemTaxTotals.ii, true, 'Alíquota deve seguir TEC/NCM e fundamento legal.');
  add('ipi', 'IPI vinculado à importação', 'Tributos importação', projectCifBrl + itemTaxTotals.ii, 'por item / TIPI', 'itens', 'BRL', itemTaxTotals.ipi, true, 'Base usada pelo motor é estimativa comercial e deve ser validada.');
  add('pis', 'PIS-Importação', 'Tributos importação', projectCifBrl, 'por item', 'itens', 'BRL', itemTaxTotals.pis, true, 'Referência editável; benefícios e regras 2026 podem alterar a alíquota.');
  add('cofins', 'COFINS-Importação', 'Tributos importação', projectCifBrl, 'por item', 'itens', 'BRL', itemTaxTotals.cofins, true, 'Referência editável; benefícios e regras 2026 podem alterar a alíquota.');
  add('icms', 'ICMS importação — estimativa comercial', 'Tributos importação', projectCifBrl, 'por item / UF', 'itens', 'BRL', itemTaxTotals.icms, true, 'Cálculo por dentro com campo de base extra; validar legislação da UF/operação.');
  add('cbs-test', 'CBS 2026 — informativo/teste', 'Transição 2026', projectCifBrl, `${conutwayV3Input(config.cbsTestRate, 2)}%`, 'itens', 'BRL', itemTaxTotals.cbsTest, Boolean(config.includeTransitionTaxes), config.includeTransitionTaxes ? 'Incluído por configuração.' : 'Não somado por padrão para evitar dupla cobrança na transição.');
  add('ibs-test', 'IBS 2026 — informativo/teste', 'Transição 2026', projectCifBrl, `${conutwayV3Input(config.ibsTestRate, 2)}%`, 'itens', 'BRL', itemTaxTotals.ibsTest, Boolean(config.includeTransitionTaxes), config.includeTransitionTaxes ? 'Incluído por configuração.' : 'Não somado por padrão para evitar dupla cobrança na transição.');
  add('afrmm', 'AFRMM', 'Frete / aduana', projectFees.freightBrl, `${conutwayV3Input(config.afrmmRate, 2)}%`, 'frete marítimo', 'USD', projectFees.fixed.afrmm, true, 'Calculado sobre frete marítimo informado.');
  add('siscomex', 'Taxa / despesas Siscomex', 'Frete / aduana', 0, 'valor informado', 'processo', 'BRL', projectFees.fixed.siscomex, true, 'Preencher conforme processo/DUIMP/DI.');
  add('terminal-procedure', 'Terminal — procedimento operacional', 'Porto', projectCifBrl, `${conutwayV3Input(config.terminalCatalog?.procedureRate, 2)}% CIF / mínimo`, 'primeiros 5 dias', 'BRL', projectFees.terminal.procedure, true, 'Rio Brasil Terminal 2026 FCL.');
  add('terminal-storage', 'Terminal — armazenagem', 'Porto', projectCifBrl, '0,80% / 1,46% / 1,88% + mínimos', `${projectFees.terminal.periods} período(s)`, 'BRL', projectFees.terminal.storage, true, 'Períodos de 6 dias ou fração após os primeiros 5 dias.');
  add('terminal-inspection', 'Terminal — inspeção não invasiva', 'Porto', 0, 'tarifa', 'por contêiner', 'BRL', projectFees.terminal.inspection, true, 'Serviço configurável.');
  add('terminal-handling', 'Terminal — movimentação / carregamento', 'Porto', 0, 'tarifa', 'por contêiner', 'BRL', projectFees.terminal.handling, true, 'Serviço configurável.');
  add('terminal-weighing', 'Terminal — pesagem', 'Porto', 0, 'tarifa', 'por contêiner', 'BRL', projectFees.terminal.weighing, true, 'Serviço configurável.');
  add('terminal-co2', 'Terminal — neutralização parcial CO₂', 'Porto', 0, 'tarifa', 'por contêiner', 'BRL', projectFees.terminal.co2, true, 'Serviço opcional.');
  add('terminal-taxes', 'Impostos sobre serviços do terminal', 'Porto', projectFees.terminal.total - projectFees.terminal.serviceTax, `${conutwayV3Input(config.terminalServiceTaxRate, 2)}%`, 'fatura', 'BRL', projectFees.terminal.serviceTax, true, 'A tabela informa acréscimo de PIS/COFINS/ISS; alíquota efetiva deve ser informada.');
  add('broker', 'Despachante aduaneiro', 'Serviços', 0, 'valor informado', 'processo', 'BRL', projectFees.fixed.customsBroker, true);
  add('local-logistics', 'Logística nacional', 'Serviços', 0, 'valor informado', 'processo', 'BRL', projectFees.fixed.localLogistics, true);
  add('demurrage', 'Demurrage / detention', 'Serviços', 0, 'valor informado', 'processo', 'BRL', projectFees.fixed.demurrageDetention, true);
  add('other', 'Outros custos', 'Serviços', 0, 'valor informado', 'processo', 'BRL', projectFees.fixed.other, true);
  add('sales-tax', 'Impostos de venda', 'Venda', commercialTotals.sales, `${conutwayV3Input(salesTaxRate * 100, 2)}%`, 'sobre venda', 'BRL', commercialTotals.salesTax, true, 'Repassado na formação do preço sugerido; preço manual pode reduzir a cobertura.');

  const pending = [];
  itemRows.forEach(({ item, value }, index) => {
    const label = item.ctCode || item.ncm || `item ${index + 1}`;
    if (value.taxes.iiRate === 0) pending.push(`${label}: confirmar II conforme NCM/TEC ou benefício.`);
    if (value.taxes.ipiRate === 0) pending.push(`${label}: confirmar IPI conforme TIPI/fundamento legal (0% pode ser válido).`);
    if (value.taxes.icmsRate === 0) pending.push(`${label}: informar/confirmar ICMS conforme UF e operação.`);
  });
  if (config.afrmmEnabled && conutwayV3Money(config.oceanFreightUsd) === 0) pending.push('Informar frete marítimo USD para calcular AFRMM, se aplicável.');
  if (config.terminal && config.terminal !== 'none' && conutwayV3Number(config.terminalServiceTaxRate, 0) === 0) pending.push('Informar alíquota efetiva de PIS/COFINS/ISS da fatura do terminal.');
  if (conutwayV3Money(config.siscomexBrl) === 0) pending.push('Confirmar taxa/despesas Siscomex/DUIMP do processo.');

  const knownCostRows = rows.filter((row) => row.valueBrl > 0 && !['cbs-test', 'ibs-test'].includes(row.key));
  const availableForLanded = Math.max(0, commercialTotals.sales - commercialTotals.salesTax);
  const knownCostCoverage = landedTotal > 0 ? Math.min(100, (availableForLanded / landedTotal) * 100) : 100;
  const unpassedKnown = knownCostCoverage < 99.999 ? 1 : 0;
  if (knownCostCoverage < 99.999) pending.unshift(`Preço de venda cobre apenas ${knownCostCoverage.toFixed(1)}% do custo posto após impostos de venda.`);
  return {
    version: 3, fx, projectCifBrl, projectFees, itemTaxTotals, itemRows, rows, landedTotal,
    salesTaxRate, profitRate, pending, commercialTotals,
    knownCostCount: knownCostRows.length,
    unpassedKnownCount: unpassedKnown,
    knownCostCoverage,
  };
}

async function conutwayV3LoadOfficialCatalog() {
  try {
    const response = await fetch(new URL(CONUTWAY_COST_CATALOG_URL, document.baseURI), { cache: 'no-store' });
    if (!response.ok) throw new Error(`catalog_http_${response.status}`);
    const catalog = await response.json();
    if (!catalog || !Array.isArray(catalog.profiles)) throw new Error('catalog_invalid');
    conutwayOfficialCostCatalog = catalog;
    return catalog;
  } catch (error) {
    console.error('conutway_cost_catalog_load_failed', error);
    return { schemaVersion: 3, profiles: [] };
  }
}

function conutwayV3NormalizeOfficialProfile(profile) {
  const normalized = normalizeCostProfile(profile);
  return {
    ...normalized,
    id: profile.id,
    name: profile.name,
    version: profile.version,
    status: profile.status,
    effectiveDate: profile.effectiveDate,
    sourceNote: profile.sourceNote,
    sourceStatus: profile.sourceStatus || 'official',
    officialCatalog: true,
    detailedCostEngine: conutwayV3Clone(profile.detailedCostEngine),
  };
}

const conutwayLegacyLoadAll = loadAll;
loadAll = async function conutwayV3LoadAll() {
  await conutwayLegacyLoadAll();
  const catalog = await conutwayV3LoadOfficialCatalog();
  if (!catalog.profiles.length) return;
  const officialIds = new Set(catalog.profiles.map((profile) => profile.id));
  const localProfiles = (state.costProfiles || []).filter((profile) => !officialIds.has(profile.id));
  const officialProfiles = catalog.profiles.map(conutwayV3NormalizeOfficialProfile);
  state.costProfiles = [...officialProfiles, ...localProfiles];
  try {
    await api.replace('costProfiles', state.costProfiles.map((profile) => conutwayV3Clone(profile)));
  } catch (error) {
    console.warn('conutway_cost_catalog_local_cache_failed', error);
  }
};

const conutwayLegacyRenderQuotationCostProfileBar = renderQuotationCostProfileBar;
renderQuotationCostProfileBar = function conutwayV3RenderQuotationCostProfileBar() {
  conutwayLegacyRenderQuotationCostProfileBar();
  const select = document.querySelector('#quoteCostProfileSelect');
  if (!select) return;
  [...select.options].forEach((option) => {
    const profile = state.costProfiles.find((item) => item.id === option.value);
    if (profile?.officialCatalog && !option.textContent.includes('OFICIAL')) option.textContent = `${profile.name} v${profile.version} • OFICIAL`;
  });
};

const conutwayLegacyApplySelectedCostProfile = applySelectedCostProfile;
applySelectedCostProfile = function conutwayV3ApplySelectedCostProfile() {
  const draft = quotationCostProfileDraft();
  const official = draft?.officialCatalog ? draft : state.costProfiles.find((profile) => profile.id === draft?.id && profile.officialCatalog);
  const detailed = conutwayV3Clone(official?.detailedCostEngine || draft?.detailedCostEngine || null);
  const result = conutwayLegacyApplySelectedCostProfile();
  if (!result || !detailed) return result;
  const project = currentProject();
  project.costEngineVersion = CONUTWAY_COST_ENGINE_VERSION;
  project.costCatalogProfileId = official?.id || draft?.id || '';
  project.costCatalogVersion = Number(official?.version || draft?.version || 0);
  project.detailedCostEngine = detailed;
  project.detailedCostEngine.itemTaxes ||= {};
  project.pricingAuditSnapshot = {
    engineVersion: 3,
    profileId: project.costCatalogProfileId,
    profileVersion: project.costCatalogVersion,
    profileName: official?.name || draft?.name || '',
    appliedAt: new Date().toISOString(),
    detailedCostEngine: conutwayV3Clone(detailed),
  };
  project.updatedAt = new Date().toISOString();
  renderItemsEditor();
  renderQuote();
  return result;
};

const conutwayLegacyCalculateQuotationItemWithFormula = calculateQuotationItemWithFormula;
calculateQuotationItemWithFormula = function conutwayV3CalculateQuotationItemWithFormula(project = {}, item = {}) {
  const legacy = conutwayLegacyCalculateQuotationItemWithFormula(project, item);
  return conutwayV3DetailedCalculation(project, item, legacy);
};

function conutwayV3SetConfigField(project, path, value) {
  const config = project.detailedCostEngine;
  if (!config) return;
  const parts = String(path || '').split('.').filter(Boolean);
  let cursor = config;
  for (let i = 0; i < parts.length - 1; i += 1) {
    cursor[parts[i]] ||= {};
    cursor = cursor[parts[i]];
  }
  cursor[parts.at(-1)] = value;
  project.pricingAuditSnapshot = {
    ...(project.pricingAuditSnapshot || {}),
    engineVersion: 3,
    profileId: project.costCatalogProfileId || project.costProfileId || '',
    profileVersion: project.costCatalogVersion || project.costProfileSnapshot?.version || 0,
    updatedAt: new Date().toISOString(),
    detailedCostEngine: conutwayV3Clone(config),
  };
  project.updatedAt = new Date().toISOString();
}

function conutwayV3ProjectField(label, path, value, options = {}) {
  const type = options.type || 'number';
  if (type === 'select') {
    return `<label><span>${conutwayV3Escape(label)}</span><select data-v3-project-field="${path}">${(options.options || []).map(([v, l]) => `<option value="${conutwayV3Escape(v)}" ${String(value) === String(v) ? 'selected' : ''}>${conutwayV3Escape(l)}</option>`).join('')}</select></label>`;
  }
  return `<label><span>${conutwayV3Escape(label)}</span><input type="number" min="${options.min ?? 0}" step="${options.step ?? '0.01'}" data-v3-project-field="${path}" value="${conutwayV3Input(value, options.digits ?? 2)}"></label>`;
}

function conutwayV3Checkbox(label, path, checked, hint = '') {
  return `<label class="v3-check"><input type="checkbox" data-v3-project-field="${path}" ${checked ? 'checked' : ''}><span><strong>${conutwayV3Escape(label)}</strong>${hint ? `<small>${conutwayV3Escape(hint)}</small>` : ''}</span></label>`;
}

function conutwayV3RenderDetailedCostPanel(project = currentProject()) {
  let panel = document.querySelector('#quotationDetailedCostPanel');
  const anchor = document.querySelector('#projectPricingPanel');
  if (!anchor) return;
  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'quotationDetailedCostPanel';
    panel.className = 'quotation-detailed-cost-panel';
    anchor.insertAdjacentElement('afterend', panel);
  }
  const breakdown = conutwayV3AllBreakdown(project);
  if (!breakdown) {
    panel.hidden = true;
    panel.innerHTML = '';
    return;
  }
  panel.hidden = false;
  const config = project.detailedCostEngine;
  const terminal = config.terminalCatalog || {};
  const coverageOk = breakdown.unpassedKnownCount === 0;
  const pendingCount = breakdown.pending.length;
  const itemTaxRows = breakdown.itemRows.map(({ item, value }, index) => {
    const tax = value.taxes;
    return `<tr>
      <td><strong>${conutwayV3Escape(item.ctCode || `Item ${index + 1}`)}</strong><small>${conutwayV3Escape(item.ncm || 'NCM pendente')}</small></td>
      ${['iiRate','ipiRate','pisImportRate','cofinsImportRate','icmsRate'].map((field) => `<td><input type="number" min="0" step="0.01" data-v3-item-field="${field}" data-v3-item-id="${conutwayV3Escape(item.id)}" value="${conutwayV3Input(tax[field], 2)}"></td>`).join('')}
      <td><input type="number" min="0" step="0.01" data-v3-item-field="icmsExtraBaseBrl" data-v3-item-id="${conutwayV3Escape(item.id)}" value="${conutwayV3Input(tax.icmsExtraBaseBrl, 2)}"></td>
      <td>${conutwayV3MoneyText(value.importTaxTotal)}</td>
    </tr>`;
  }).join('');

  const memoryRows = breakdown.rows.map((row) => `<tr class="${row.passedThrough ? '' : 'is-info-only'}">
    <td><span class="v3-group">${conutwayV3Escape(row.group)}</span><strong>${conutwayV3Escape(row.label)}</strong>${row.note ? `<small>${conutwayV3Escape(row.note)}</small>` : ''}</td>
    <td>${row.baseBrl ? conutwayV3MoneyText(row.baseBrl) : '—'}</td>
    <td>${conutwayV3Escape(row.rateLabel)}</td>
    <td>${conutwayV3Escape(row.qtyPeriod)}</td>
    <td>${conutwayV3Escape(row.original)}</td>
    <td>${row.original === 'USD' ? conutwayV3Input(row.fx, 4) : '—'}</td>
    <td><strong>${conutwayV3MoneyText(row.valueBrl)}</strong></td>
    <td><span class="v3-pass ${row.passedThrough ? 'yes' : 'info'}">${row.passedThrough ? 'SIM' : 'INFO'}</span></td>
  </tr>`).join('');

  panel.innerHTML = `
    <header class="v3-cost-head">
      <div><span class="v3-badge">MOTOR DE CUSTOS V3</span><h3>Memória de cálculo da importação</h3><p>Impostos e taxas separados, com base, alíquota/tarifa, período, câmbio, BRL e confirmação de repasse.</p></div>
      <div class="v3-health"><strong class="${coverageOk ? 'ok' : 'bad'}">${coverageOk ? '100%' : `${breakdown.knownCostCoverage.toFixed(0)}%`}</strong><span>custos calculados repassados</span><small class="${pendingCount ? 'warning' : 'ok'}">${pendingCount} parâmetro(s) pendente(s)</small></div>
    </header>

    <div class="v3-config-grid">
      ${conutwayV3ProjectField('Terminal / tabela', 'terminal', config.terminal, { type: 'select', options: [['rio-brasil-2026-fcl','Rio Brasil Terminal 2026 — FCL'],['none','Sem terminal automático']] })}
      ${conutwayV3ProjectField('Contêiner', 'containerSize', config.containerSize, { type: 'select', options: [['20','20 pés'],['40','40 pés']] })}
      ${conutwayV3ProjectField('Dias no terminal', 'daysAtTerminal', config.daysAtTerminal, { step: 1, digits: 0 })}
      ${conutwayV3ProjectField('Frete marítimo USD', 'oceanFreightUsd', config.oceanFreightUsd)}
      ${conutwayV3ProjectField('AFRMM (%)', 'afrmmRate', config.afrmmRate)}
      ${conutwayV3ProjectField('Siscomex / DUIMP BRL', 'siscomexBrl', config.siscomexBrl)}
      ${conutwayV3ProjectField('Despachante BRL', 'customsBrokerBrl', config.customsBrokerBrl)}
      ${conutwayV3ProjectField('Logística nacional BRL', 'localLogisticsBrl', config.localLogisticsBrl)}
      ${conutwayV3ProjectField('Demurrage / detention BRL', 'demurrageDetentionBrl', config.demurrageDetentionBrl)}
      ${conutwayV3ProjectField('Outros custos BRL', 'otherBrl', config.otherBrl)}
      ${conutwayV3ProjectField('PIS/COFINS/ISS terminal (%)', 'terminalServiceTaxRate', config.terminalServiceTaxRate)}
    </div>

    <div class="v3-switch-columns">
      <section><h4>Serviços portuários</h4>${conutwayV3Checkbox('Inspeção não invasiva', 'services.inspection', config.services?.inspection)}${conutwayV3Checkbox('Movimentação / carregamento', 'services.handling', config.services?.handling)}${conutwayV3Checkbox('Pesagem', 'services.weighing', config.services?.weighing)}${conutwayV3Checkbox('Neutralização parcial CO₂', 'services.co2', config.services?.co2)}</section>
      <section><h4>Adicionais de risco/operação</h4>${conutwayV3Checkbox('OOG / Flat Rack / Open Top', 'conditions.oog', config.conditions?.oog, '+200% procedimentos/armazenagem')}${conutwayV3Checkbox('Controle sanitário / cama Flat Rack', 'conditions.sanitary', config.conditions?.sanitary, '+100%')}${conutwayV3Checkbox('IMO / IMDG', 'conditions.imo', config.conditions?.imo, '+100% inclusive serviços')}${conutwayV3Checkbox('FCL desovado para armazém', 'conditions.destuffedFcl', config.conditions?.destuffedFcl, '+200%')}${conutwayV3Checkbox('Equipamento superior a 40 pés', 'conditions.over40', config.conditions?.over40, '+100%')}</section>
    </div>

    <section class="v3-tax-section">
      <div class="v3-section-title"><div><h4>Tributos por item / NCM</h4><p>II, IPI e ICMS não são fixados pelo sistema: valide NCM, fundamento legal, UF e operação. PIS/COFINS são referências editáveis.</p></div><span>ICMS = estimativa comercial</span></div>
      <div class="v3-table-wrap"><table class="v3-tax-table"><thead><tr><th>ITEM / NCM</th><th>II %</th><th>IPI %</th><th>PIS-IMP %</th><th>COFINS-IMP %</th><th>ICMS %</th><th>BASE EXTRA ICMS BRL</th><th>TRIBUTOS IMP.</th></tr></thead><tbody>${itemTaxRows}</tbody></table></div>
    </section>

    <section class="v3-memory-section">
      <div class="v3-section-title"><div><h4>Memória de cálculo linha a linha</h4><p>Os valores positivos abaixo entram no custo posto ou no preço de venda; CBS/IBS 2026 permanecem informativos por padrão.</p></div><strong>${conutwayV3MoneyText(breakdown.landedTotal)}</strong></div>
      <div class="v3-table-wrap"><table class="v3-memory-table"><thead><tr><th>CUSTO / TRIBUTO</th><th>BASE</th><th>ALÍQ./TARIFA</th><th>QTD./PERÍODO</th><th>MOEDA</th><th>CÂMBIO</th><th>BRL</th><th>REPASSADO</th></tr></thead><tbody>${memoryRows}</tbody></table></div>
    </section>

    <section class="v3-pending ${pendingCount ? 'has-pending' : 'is-clear'}"><header><strong>${pendingCount ? 'Pendências antes de fechar a cotação' : 'Cobertura concluída'}</strong><span>${pendingCount ? 'O sistema não oculta parâmetros não configurados.' : 'Todos os parâmetros críticos informados.'}</span></header>${pendingCount ? `<ul>${breakdown.pending.map((item) => `<li>${conutwayV3Escape(item)}</li>`).join('')}</ul>` : ''}</section>
    <footer class="v3-source-note">Tabela portuária: ${conutwayV3Escape(terminal.name || 'configuração manual')} • vigência ${conutwayV3Escape(terminal.effectiveDate || '—')} • Perfil ${conutwayV3Escape(project.costCatalogProfileId || project.costProfileId || 'local')} v${conutwayV3Escape(project.costCatalogVersion || project.costProfileSnapshot?.version || '—')}.</footer>
  `;
}

const conutwayLegacyCaptureProjectForm = captureProjectForm;
captureProjectForm = function conutwayV3CaptureProjectForm(options = {}) {
  const project = conutwayLegacyCaptureProjectForm(options);
  if (conutwayV3Config(project)) {
    project.pricingAuditSnapshot = {
      ...(project.pricingAuditSnapshot || {}),
      engineVersion: 3,
      profileId: project.costCatalogProfileId || project.costProfileId || '',
      profileVersion: project.costCatalogVersion || project.costProfileSnapshot?.version || 0,
      savedAt: new Date().toISOString(),
      detailedCostEngine: conutwayV3Clone(project.detailedCostEngine),
      lastCalculation: conutwayV3Clone(conutwayV3AllBreakdown(project)),
    };
  }
  return project;
};

const conutwayLegacyQuotationReadinessModel = quotationReadinessModel;
quotationReadinessModel = function conutwayV3QuotationReadinessModel(project = currentProject()) {
  const model = conutwayLegacyQuotationReadinessModel(project);
  const breakdown = conutwayV3AllBreakdown(project);
  if (!breakdown) return model;
  if (breakdown.knownCostCoverage < 99.999) {
    model.blocking.push({ label: 'Cobertura insuficiente de custos', detail: `${breakdown.knownCostCoverage.toFixed(1)}%`, view: 'pricing', target: '#quotationDetailedCostPanel' });
  }
  if (breakdown.pending.length) {
    model.warnings.push({ label: `${breakdown.pending.length} parâmetro(s) fiscal(is)/logístico(s) pendente(s)`, detail: 'Revisar memória de cálculo', view: 'pricing', target: '#quotationDetailedCostPanel' });
  }
  return model;
};

const conutwayLegacyRenderItemsEditor = renderItemsEditor;
renderItemsEditor = function conutwayV3RenderItemsEditor() {
  const result = conutwayLegacyRenderItemsEditor();
  conutwayV3RenderDetailedCostPanel(currentProject());
  return result;
};

const conutwayLegacyRefreshQuotationItem = refreshQuotationItem;
refreshQuotationItem = function conutwayV3RefreshQuotationItem(index, options = {}) {
  const result = conutwayLegacyRefreshQuotationItem(index, options);
  conutwayV3RenderDetailedCostPanel(currentProject());
  return result;
};

const conutwayLegacyRefreshProjectPricingOutputs = refreshProjectPricingOutputs;
refreshProjectPricingOutputs = function conutwayV3RefreshProjectPricingOutputs(project = currentProject()) {
  const result = conutwayLegacyRefreshProjectPricingOutputs(project);
  conutwayV3RenderDetailedCostPanel(project);
  return result;
};

document.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const projectPath = target.dataset.v3ProjectField;
  const itemField = target.dataset.v3ItemField;
  if (!projectPath && !itemField) return;
  const project = currentProject();
  if (!conutwayV3Config(project)) return;

  if (projectPath) {
    const value = target instanceof HTMLInputElement && target.type === 'checkbox'
      ? target.checked
      : (target instanceof HTMLInputElement && target.type === 'number' ? conutwayV3Number(target.value, 0) : target.value);
    conutwayV3SetConfigField(project, projectPath, value);
  }
  if (itemField) {
    const itemId = String(target.dataset.v3ItemId || '');
    const item = (project.items || []).find((candidate) => candidate.id === itemId);
    if (!item) return;
    project.detailedCostEngine.itemTaxes ||= {};
    const current = conutwayV3ItemTaxConfig(project, item);
    project.detailedCostEngine.itemTaxes[itemId] = {
      ...current,
      [itemField]: conutwayV3Number(target.value, 0),
    };
    if (itemField === 'ipiRate') item.ipiRate = conutwayV3Number(target.value, 0);
    if (itemField === 'icmsRate') item.icmsRate = conutwayV3Number(target.value, 0);
    conutwayV3SetConfigField(project, 'itemTaxes', project.detailedCostEngine.itemTaxes);
  }
  renderItemsEditor();
  renderQuote();
});

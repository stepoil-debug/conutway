/* CONUTWAY QUOTATION NCM TAX SYNC V1 INDEX FIX */

/* Reaproveitar uma regra fiscal pelo NCM não pode transformar o item em outro
   produto que tenha o mesmo código fiscal. Preservamos identidade/descrição e
   copiamos somente a regra tributária. */
const conutwayNcmLegacyApplyFiscalProfileByIdentity = conutwayNcmApplyFiscalProfile;
conutwayNcmApplyFiscalProfile = function conutwayNcmApplyFiscalProfileSafe(project, item, product, options = {}) {
  if (options.source !== 'ncm') {
    return conutwayNcmLegacyApplyFiscalProfileByIdentity(project, item, product, options);
  }
  const identity = {
    productId: item.productId,
    ctCode: item.ctCode,
    ncm: item.ncm,
    descriptionPt: item.descriptionPt,
    descriptionEn: item.descriptionEn,
    uom: item.uom,
  };
  const result = conutwayNcmLegacyApplyFiscalProfileByIdentity(project, item, product, options);
  Object.assign(item, identity);
  const rule = project.detailedCostEngine?.itemTaxes?.[item.id];
  if (rule) {
    rule._source = 'ncm';
    rule._ruleProductId = String(product.id || '');
    rule._productId = String(identity.productId || '');
    rule._ctCode = String(identity.ctCode || '');
    rule._ncm = conutwayNcmKey(identity.ncm);
  }
  item.fiscalSource = 'ncm';
  item.fiscalNcmKey = conutwayNcmKey(identity.ncm);
  return result;
};

document.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.dataset.itemField !== 'ncm') return;
  const index = Number(target.dataset.index);
  if (!Number.isInteger(index)) return;
  const project = currentProject();
  const item = project.items?.[index];
  if (!item || !conutwayV3Config(project)) return;

  const resolved = conutwayNcmSyncItem(project, item, { force: true });
  if (!resolved.product) {
    project.detailedCostEngine.itemTaxes ||= {};
    delete project.detailedCostEngine.itemTaxes[item.id];
    item.fiscalSource = resolved.ambiguous ? 'ambiguous' : 'pending';
    item.fiscalNcmKey = conutwayNcmKey(item.ncm);
  }

  queueMicrotask(() => {
    renderItemsEditor();
    renderQuote();
  });
});

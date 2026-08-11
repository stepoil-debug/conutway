/* CONUTWAY QUOTATION NCM TAX SYNC V1 INDEX FIX */

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

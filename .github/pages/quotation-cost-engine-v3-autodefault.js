/* CONUTWAY QUOTATION COST ENGINE V3 AUTO DEFAULT */

function conutwayV3OfficialProfile() {
  return (state.costProfiles || []).find((profile) => profile.officialCatalog && profile.detailedCostEngine?.enabled) || null;
}

function conutwayV3HasPricing(project = {}) {
  return Boolean(project.detailedCostEngine?.enabled || project.costProfileSnapshot || project.formulaSnapshot || project.costProfileId);
}

function conutwayV3ApplyOfficialDefaults(project = {}, official = conutwayV3OfficialProfile()) {
  if (!official) return normalizeProject(project);
  const normalized = normalizeProject(project);
  if (conutwayV3HasPricing(normalized)) {
    if ((normalized.costCatalogProfileId === official.id || normalized.costProfileId === official.id) && !normalized.detailedCostEngine?.enabled) {
      normalized.costEngineVersion = 3;
      normalized.costCatalogProfileId = official.id;
      normalized.costCatalogVersion = Number(official.version || 3);
      normalized.detailedCostEngine = conutwayV3Clone(official.detailedCostEngine);
    }
    return normalized;
  }

  const priced = withFormulaSnapshot(normalizeProject(
    BrErpPricing.applyProfileSnapshotToQuotation(normalized, official),
  ), official);
  priced.costEngineVersion = 3;
  priced.costCatalogProfileId = official.id;
  priced.costCatalogVersion = Number(official.version || 3);
  priced.detailedCostEngine = conutwayV3Clone(official.detailedCostEngine);
  priced.detailedCostEngine.itemTaxes ||= {};
  priced.pricingAuditSnapshot = {
    engineVersion: 3,
    profileId: official.id,
    profileVersion: Number(official.version || 3),
    profileName: official.name || '',
    appliedAt: new Date().toISOString(),
    applicationMode: 'automatic-default',
    detailedCostEngine: conutwayV3Clone(priced.detailedCostEngine),
  };
  priced.updatedAt = new Date().toISOString();
  return priced;
}

const conutwayV3CatalogAwareLoadAll = loadAll;
loadAll = async function conutwayV3AutoProfileLoadAll() {
  await conutwayV3CatalogAwareLoadAll();
  const official = conutwayV3OfficialProfile();
  if (!official) return;
  state.projects = (state.projects || []).map((project) => conutwayV3ApplyOfficialDefaults(project, official));
};

const conutwayLegacyBlankProjectV3 = blankProject;
blankProject = function conutwayV3BlankProjectWithOfficialCosts() {
  return conutwayV3ApplyOfficialDefaults(conutwayLegacyBlankProjectV3(), conutwayV3OfficialProfile());
};

const conutwayLegacyEnsureCurrentProjectDraftV3 = ensureCurrentProjectDraft;
ensureCurrentProjectDraft = function conutwayV3EnsureCurrentProjectDraft() {
  const project = conutwayLegacyEnsureCurrentProjectDraftV3();
  if (!conutwayV3HasPricing(project)) {
    state.projects[state.currentProjectIndex] = conutwayV3ApplyOfficialDefaults(project, conutwayV3OfficialProfile());
  }
  return currentProject();
};

const conutwayLegacyRenderQuotationCostProfileBarV3Auto = renderQuotationCostProfileBar;
renderQuotationCostProfileBar = function conutwayV3RenderQuotationCostProfileBarAuto() {
  const project = currentProject();
  if (!conutwayV3HasPricing(project)) {
    state.projects[state.currentProjectIndex] = conutwayV3ApplyOfficialDefaults(project, conutwayV3OfficialProfile());
    resetQuotationCostProfileDraft();
  }
  return conutwayLegacyRenderQuotationCostProfileBarV3Auto();
};

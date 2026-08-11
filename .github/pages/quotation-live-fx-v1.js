/* CONUTWAY QUOTATION LIVE FX V1
   Atualização sob demanda do USD/BRL pela API oficial PTAX do Banco Central.
   A cotação é gravada no snapshot da cotação, sem alterar o catálogo oficial. */

const CONUTWAY_LIVE_FX_VERSION = 1;
const CONUTWAY_BCB_PTAX_ENDPOINT = 'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarDia(dataCotacao=@dataCotacao)';

function conutwayLiveFxDateKey(date) {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${mm}-${dd}-${date.getFullYear()}`;
}

function conutwayLiveFxDatePtBr(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(date);
}

async function conutwayLiveFxFetchBcbLatest() {
  let lastError = null;
  for (let back = 0; back <= 7; back += 1) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - back);
    const url = new URL(CONUTWAY_BCB_PTAX_ENDPOINT);
    url.searchParams.set('@dataCotacao', `'${conutwayLiveFxDateKey(date)}'`);
    url.searchParams.set('$format', 'json');

    try {
      const response = await fetch(url.toString(), { cache: 'no-store' });
      if (!response.ok) throw new Error(`PTAX HTTP ${response.status}`);
      const payload = await response.json();
      const rows = Array.isArray(payload?.value) ? payload.value : [];
      const valid = rows
        .filter((row) => Number(row?.cotacaoVenda) > 0)
        .sort((a, b) => new Date(b.dataHoraCotacao || 0) - new Date(a.dataHoraCotacao || 0));
      if (!valid.length) continue;
      const row = valid[0];
      return {
        rate: Number(row.cotacaoVenda),
        buyRate: Number(row.cotacaoCompra || 0),
        quotedAt: row.dataHoraCotacao || null,
        requestedAt: new Date().toISOString(),
        referenceDate: conutwayLiveFxDateKey(date),
        source: 'Banco Central do Brasil — PTAX',
        sourceCode: 'bcb-ptax-usd-brl-sale',
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Nenhuma cotação PTAX disponível nos últimos 7 dias.');
}

function conutwayLiveFxSnapshotWithRate(snapshot, rate) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const cloned = typeof conutwayV3Clone === 'function'
    ? conutwayV3Clone(snapshot)
    : JSON.parse(JSON.stringify(snapshot));
  return { ...cloned, fxRate: rate };
}

function conutwayLiveFxApplySnapshot(project, fx) {
  if (!project || !fx || !(fx.rate > 0)) return false;

  let updatedAnySnapshot = false;
  const replaceSnapshot = (owner, field) => {
    const next = conutwayLiveFxSnapshotWithRate(owner?.[field], fx.rate);
    if (!next) return false;
    owner[field] = next;
    return true;
  };

  // Os snapshots do motor podem ser normalizados/recriados pelo ERP. Em vez de
  // alterar fxRate dentro do objeto existente, substituímos o snapshot completo.
  // Assim a nova taxa passa a ser a fonte efetiva do cálculo imediatamente.
  updatedAnySnapshot = replaceSnapshot(project, 'formulaSnapshot') || updatedAnySnapshot;
  updatedAnySnapshot = replaceSnapshot(project, 'costProfileSnapshot') || updatedAnySnapshot;

  (project.items || []).forEach((item) => {
    updatedAnySnapshot = replaceSnapshot(item, 'formulaSnapshot') || updatedAnySnapshot;
    updatedAnySnapshot = replaceSnapshot(item, 'costProfileSnapshot') || updatedAnySnapshot;
  });

  // Projeto legado sem snapshot: parte do perfil ativo e cria snapshots locais.
  if (!updatedAnySnapshot) {
    const profile = conutwayV3ProfileForProject(project)
      || (typeof conutwayV3OfficialProfile === 'function' ? conutwayV3OfficialProfile() : null);
    if (profile) {
      project.formulaSnapshot = conutwayLiveFxSnapshotWithRate(profile, fx.rate);
      project.costProfileSnapshot = conutwayLiveFxSnapshotWithRate(profile, fx.rate);
      (project.items || []).forEach((item) => {
        item.formulaSnapshot = conutwayLiveFxSnapshotWithRate(profile, fx.rate);
        if (item.costProfileSnapshot) item.costProfileSnapshot = conutwayLiveFxSnapshotWithRate(item.costProfileSnapshot, fx.rate);
      });
      updatedAnySnapshot = true;
    }
  }

  project.liveFx = { ...fx, version: CONUTWAY_LIVE_FX_VERSION };
  project.pricingAuditSnapshot = {
    ...(project.pricingAuditSnapshot || {}),
    fx: { ...project.liveFx },
    updatedAt: new Date().toISOString(),
  };
  project.updatedAt = new Date().toISOString();

  if (state.quoteCostProfileDraft && typeof state.quoteCostProfileDraft === 'object') {
    state.quoteCostProfileDraft = conutwayLiveFxSnapshotWithRate(state.quoteCostProfileDraft, fx.rate);
  }
  return updatedAnySnapshot;
}

async function conutwayLiveFxPersistProjects() {
  try {
    if (typeof api !== 'undefined' && typeof api.replace === 'function') {
      await api.replace('projects', (state.projects || []).map((project) => conutwayV3Clone(project)));
    }
  } catch (error) {
    console.warn('conutway_live_fx_persist_failed', error);
  }
}

function conutwayLiveFxStatus(project = currentProject()) {
  const meta = project?.liveFx;
  if (!meta?.rate) return 'Câmbio do perfil/manual';
  return `${meta.source || 'PTAX'} • ${Number(meta.rate).toFixed(4)} • ${conutwayLiveFxDatePtBr(meta.quotedAt || meta.requestedAt)}`;
}

function conutwayLiveFxDecoratePricingBar() {
  const select = document.querySelector('#quoteCostProfileSelect');
  const bar = select?.closest('.estimated-cost-profile-bar') || select?.parentElement;
  if (!select || !bar || bar.querySelector('[data-live-fx-control="v1"]')) return;

  const project = currentProject();
  const formula = conutwayV3Formula(project);
  const raw = Math.max(0, Number(formula?.fxRate || 0));
  const effective = conutwayV3EffectiveFx(formula);

  const control = document.createElement('div');
  control.className = 'live-fx-control';
  control.dataset.liveFxControl = 'v1';
  control.innerHTML = `
    <div class="live-fx-values">
      <span class="live-fx-label">Câmbio USD/BRL</span>
      <strong data-live-fx-raw>${raw ? raw.toFixed(4) : '—'}</strong>
      <small data-live-fx-effective>Efetivo c/ buffer: ${effective ? effective.toFixed(4) : '—'}</small>
      <small class="live-fx-source" data-live-fx-source>${conutwayV3Escape(conutwayLiveFxStatus(project))}</small>
    </div>
    <button type="button" class="secondary live-fx-refresh" data-live-fx-refresh>Atualizar câmbio agora</button>
  `;
  const refreshButton = control.querySelector('[data-live-fx-refresh]');
  refreshButton?.addEventListener('click', () => conutwayLiveFxRefresh(refreshButton));
  bar.appendChild(control);
}

async function conutwayLiveFxRefresh(button) {
  const project = currentProject();
  if (!project) return;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Buscando PTAX...';
  try {
    const fx = await conutwayLiveFxFetchBcbLatest();
    if (!conutwayLiveFxApplySnapshot(project, fx)) {
      throw new Error('Nenhum snapshot de precificação disponível para aplicar o câmbio.');
    }

    // A tela e os cálculos são atualizados antes da persistência: o usuário não
    // precisa esperar IndexedDB/storage para ver a nova cotação aplicada.
    if (typeof resetQuotationCostProfileDraft === 'function') resetQuotationCostProfileDraft();
    renderQuotationCostProfileBar();
    renderItemsEditor();
    renderQuote();
    void conutwayLiveFxPersistProjects();
  } catch (error) {
    console.error('conutway_live_fx_update_failed', error);
    button.disabled = false;
    button.textContent = 'Falha ao atualizar — tentar novamente';
    button.title = String(error?.message || error || 'Falha ao consultar PTAX');
    setTimeout(() => {
      if (button.isConnected) {
        button.textContent = original;
        button.disabled = false;
      }
    }, 3500);
  }
}

const conutwayLiveFxLegacyRenderQuotationCostProfileBar = renderQuotationCostProfileBar;
renderQuotationCostProfileBar = function conutwayLiveFxRenderQuotationCostProfileBar() {
  const result = conutwayLiveFxLegacyRenderQuotationCostProfileBar();
  conutwayLiveFxDecoratePricingBar();
  return result;
};

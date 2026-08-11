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

function conutwayLiveFxApplySnapshot(project, fx) {
  if (!project || !fx || !(fx.rate > 0)) return false;

  const updateSnapshot = (snapshot) => {
    if (!snapshot || typeof snapshot !== 'object') return;
    snapshot.fxRate = fx.rate;
  };
  updateSnapshot(project.formulaSnapshot);
  updateSnapshot(project.costProfileSnapshot);

  // Projetos V3 normalmente já possuem snapshot. Se algum legado não possuir,
  // cria um snapshot local a partir do perfil ativo sem alterar o catálogo global.
  if (!project.formulaSnapshot && !project.costProfileSnapshot) {
    const profile = conutwayV3ProfileForProject(project) || conutwayV3OfficialProfile?.() || null;
    if (profile) {
      project.formulaSnapshot = conutwayV3Clone(profile);
      project.formulaSnapshot.fxRate = fx.rate;
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
    state.quoteCostProfileDraft.fxRate = fx.rate;
  }
  return true;
}

async function conutwayLiveFxPersistProjects() {
  try {
    if (typeof api?.replace === 'function') {
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
    conutwayLiveFxApplySnapshot(project, fx);
    await conutwayLiveFxPersistProjects();
    if (typeof resetQuotationCostProfileDraft === 'function') resetQuotationCostProfileDraft();
    // Reaplica o valor ao draft recriado, para o formulário mostrar a mesma taxa do snapshot.
    if (state.quoteCostProfileDraft && typeof state.quoteCostProfileDraft === 'object') {
      state.quoteCostProfileDraft.fxRate = fx.rate;
    }
    renderQuotationCostProfileBar();
    renderItemsEditor();
    renderQuote();
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

document.addEventListener('click', (event) => {
  const button = event.target?.closest?.('[data-live-fx-refresh]');
  if (!button) return;
  conutwayLiveFxRefresh(button);
});

/* CONUTWAY SIDEBAR COLLAPSIBLE PREMIUM V1 */
(() => {
  const STORAGE_KEY = 'conutway.sidebar.collapsed.v1';
  const DESKTOP_QUERY = '(min-width: 981px)';
  const OFFICIAL_PROPOSAL_LOGO = 'assets/conutway-teza-logo-v2.svg';
  const SHORTCUTS = {
    dashboard: 'VI',
    internalRfqs: 'RF',
    customers: 'CL',
    projects: 'CO',
    contracts: 'CT',
    projectAccounts: 'CF',
    suppliers: 'FO',
    purchaseOrders: 'PO',
    inventory: 'ES',
    products: 'PR',
    options: 'OP',
    documents: 'DO',
    sellers: 'EV',
    users: 'US',
  };

  /*
   * O bundle legado bloqueia internalRfqs quando serverStorageAllowed() é false.
   * No GitHub Pages os rascunhos de RFQ já possuem armazenamento local (IndexedDB),
   * portanto liberamos o módulo e mantemos o scheduler remoto desligado para não
   * gerar chamadas repetidas para /api/rfq-exchange em um host estático.
   */
  const installPagesInternalRfq = () => {
    try {
      if (window.__conutwayPagesInternalRfqEnabled) return;
      if (typeof canCurrentUserAccessModule === 'function') {
        const baseCanAccessModule = canCurrentUserAccessModule;
        canCurrentUserAccessModule = function pagesCanCurrentUserAccessModule(moduleName = '') {
          if (moduleName === 'internalRfqs') return true;
          return baseCanAccessModule(moduleName);
        };
      }
      if (typeof reconcileRfqSchedulerAccess === 'function') {
        reconcileRfqSchedulerAccess = function pagesReconcileRfqSchedulerAccess() {
          try { rfqController?.stopScheduler?.(); } catch (_) {}
          return false;
        };
      }
      window.__conutwayPagesInternalRfqEnabled = true;
    } catch (_) {}
  };

  const ensureInternalRfqAccess = () => {
    const buttons = document.querySelectorAll('[data-module-target="internalRfqs"], [data-dashboard-module="internalRfqs"]');
    buttons.forEach((button) => {
      if (button.hidden) button.hidden = false;
      if (button.disabled) button.disabled = false;
      if (button.hasAttribute('hidden')) button.removeAttribute('hidden');
      if (button.hasAttribute('disabled')) button.removeAttribute('disabled');
      if (button.getAttribute('aria-disabled') !== 'false') button.setAttribute('aria-disabled', 'false');
    });
    const workspace = document.getElementById('internalRfqWorkspace');
    if (workspace) {
      workspace.querySelectorAll('[data-rfq-action="sync"]').forEach((button) => {
        if (!button.disabled) button.disabled = true;
        const title = 'Sincronização com servidor indisponível no ambiente demonstrativo';
        if (button.title !== title) button.title = title;
        if (button.getAttribute('aria-label') !== title) button.setAttribute('aria-label', title);
      });
    }
  };

  const observeInternalRfqAccess = () => {
    ensureInternalRfqAccess();
    const root = document.body;
    if (!root || window.__conutwayPagesInternalRfqObserver) return;
    const observer = new MutationObserver(() => ensureInternalRfqAccess());
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'disabled'] });
    window.__conutwayPagesInternalRfqObserver = observer;
  };

  /* CONUTWAY PROPOSAL OFFICIAL BRAND V1 */
  const ensureOfficialProposalLogo = () => {
    document.querySelectorAll('.quote-header img, .mini-quote-header img').forEach((logo) => {
      const current = String(logo.getAttribute('src') || '');
      if (!current.endsWith('conutway-teza-logo-v2.svg')) {
        logo.setAttribute('src', OFFICIAL_PROPOSAL_LOGO);
      }
      if (logo.getAttribute('alt') !== 'CONUTWAY TEZA') {
        logo.setAttribute('alt', 'CONUTWAY TEZA');
      }
    });
  };

  const observeOfficialProposalLogo = () => {
    ensureOfficialProposalLogo();
    const root = document.body;
    if (!root || window.__conutwayProposalBrandObserver) return;
    const observer = new MutationObserver(() => ensureOfficialProposalLogo());
    observer.observe(root, { subtree: true, childList: true });
    window.__conutwayProposalBrandObserver = observer;
  };

  installPagesInternalRfq();

  const readPreference = () => {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; }
    catch (_) { return false; }
  };

  const savePreference = (collapsed) => {
    try { localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0'); }
    catch (_) {}
  };

  const installCollapsedPolish = () => {
    if (document.getElementById('conutwaySidebarCollapsedV3')) return;
    const style = document.createElement('style');
    style.id = 'conutwaySidebarCollapsedV3';
    style.textContent = `
      @media screen and (min-width:981px){
        body.sidebar-collapsed #workspaceSidebar .brand-block{
          width:64px!important;
          min-height:72px!important;
          height:72px!important;
          margin:0 auto 10px!important;
          padding:0!important;
          display:flex!important;
          align-items:center!important;
          justify-content:center!important;
          overflow:visible!important;
        }
        body.sidebar-collapsed #workspaceSidebar .brand-logo-full{
          display:none!important;
        }
        body.sidebar-collapsed #workspaceSidebar .brand-logo-emblem{
          display:block!important;
          width:38px!important;
          height:34px!important;
          max-width:38px!important;
          max-height:34px!important;
          margin:0 auto!important;
          padding:0!important;
          transform:none!important;
          overflow:visible!important;
        }
        body.sidebar-collapsed #workspaceSidebar .sidebar-collapse-toggle{
          top:24px!important;
          right:-18px!important;
          width:29px!important;
          height:29px!important;
          border-radius:9px!important;
        }
        body.sidebar-collapsed #workspaceSidebar .module-nav{
          overflow-x:hidden!important;
          overflow-y:auto!important;
          scrollbar-width:none!important;
          -ms-overflow-style:none!important;
          scrollbar-gutter:auto!important;
          padding-right:8px!important;
        }
        body.sidebar-collapsed #workspaceSidebar .module-nav::-webkit-scrollbar{
          display:none!important;
          width:0!important;
          height:0!important;
        }
        body.sidebar-collapsed #workspaceSidebar .module-nav::-webkit-scrollbar-track,
        body.sidebar-collapsed #workspaceSidebar .module-nav::-webkit-scrollbar-thumb,
        body.sidebar-collapsed #workspaceSidebar .module-nav::-webkit-scrollbar-button,
        body.sidebar-collapsed #workspaceSidebar .module-nav::-webkit-scrollbar-corner{
          display:none!important;
          width:0!important;
          height:0!important;
          background:transparent!important;
        }
      }
    `;
    document.head.appendChild(style);
  };

  const init = () => {
    observeOfficialProposalLogo();

    const sidebar = document.getElementById('workspaceSidebar') || document.querySelector('.sidebar');
    if (!sidebar || document.getElementById('sidebarCollapseBtn')) {
      observeInternalRfqAccess();
      return;
    }

    installCollapsedPolish();
    observeInternalRfqAccess();

    const media = window.matchMedia(DESKTOP_QUERY);
    const moduleNav = sidebar.querySelector('.module-nav');
    const moduleButtons = [...sidebar.querySelectorAll('.module-nav button[data-module-target]')];
    const fullLogo = sidebar.querySelector('.brand-logo-full');
    const emblemLogo = sidebar.querySelector('.brand-logo-emblem');

    moduleButtons.forEach((button) => {
      const target = button.dataset.moduleTarget || '';
      const label = (button.textContent || '').replace(/\s+/g, ' ').trim();
      const fallback = label
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((word) => word[0] || '')
        .join('')
        .toUpperCase()
        .slice(0, 2) || '•';
      button.dataset.navShort = SHORTCUTS[target] || fallback;
      button.dataset.navLabel = label;
      if (label) {
        button.setAttribute('title', label);
        if (!button.getAttribute('aria-label')) button.setAttribute('aria-label', label);
      }
    });

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.id = 'sidebarCollapseBtn';
    toggle.className = 'sidebar-collapse-toggle';
    toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14.5 6.5 9 12l5.5 5.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    sidebar.appendChild(toggle);

    const applyBrandState = (collapsed) => {
      if (fullLogo) {
        fullLogo.style.setProperty('display', collapsed ? 'none' : 'block', 'important');
        if (!collapsed) {
          fullLogo.style.removeProperty('width');
          fullLogo.style.removeProperty('height');
          fullLogo.style.removeProperty('max-width');
          fullLogo.style.removeProperty('transform');
        }
      }
      if (emblemLogo) {
        emblemLogo.style.setProperty('display', collapsed ? 'block' : 'none', 'important');
        if (collapsed) {
          emblemLogo.style.setProperty('width', '38px', 'important');
          emblemLogo.style.setProperty('height', '34px', 'important');
          emblemLogo.style.setProperty('max-width', '38px', 'important');
          emblemLogo.style.setProperty('max-height', '34px', 'important');
          emblemLogo.style.setProperty('object-fit', 'contain', 'important');
          emblemLogo.style.setProperty('object-position', 'center', 'important');
          emblemLogo.style.setProperty('transform', 'none', 'important');
          emblemLogo.style.setProperty('margin', '0 auto', 'important');
          emblemLogo.style.setProperty('filter', 'brightness(0) invert(1) opacity(.98) drop-shadow(0 7px 16px rgba(0,0,0,.24))', 'important');
        }
      }
    };

    const applyState = (collapsed, persist = false) => {
      const effective = Boolean(collapsed && media.matches);
      document.body.classList.toggle('sidebar-collapsed', effective);
      document.body.dataset.sidebarState = effective ? 'collapsed' : 'expanded';
      toggle.setAttribute('aria-expanded', String(!effective));
      toggle.setAttribute('aria-label', effective ? 'Expandir menu lateral' : 'Recolher menu lateral');
      toggle.setAttribute('title', effective ? 'Expandir menu lateral' : 'Recolher menu lateral');
      applyBrandState(effective);
      if (moduleNav && effective) {
        moduleNav.style.setProperty('overflow-x', 'hidden', 'important');
        moduleNav.style.setProperty('overflow-y', 'auto', 'important');
        moduleNav.style.setProperty('scrollbar-width', 'none', 'important');
      }
      if (persist) savePreference(Boolean(collapsed));
      window.dispatchEvent(new CustomEvent('conutway:sidebar-state', { detail: { collapsed: effective } }));
    };

    toggle.addEventListener('click', () => {
      applyState(!document.body.classList.contains('sidebar-collapsed'), true);
    });

    const onMediaChange = () => applyState(readPreference(), false);
    if (typeof media.addEventListener === 'function') media.addEventListener('change', onMediaChange);
    else if (typeof media.addListener === 'function') media.addListener(onMediaChange);

    applyState(readPreference(), false);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
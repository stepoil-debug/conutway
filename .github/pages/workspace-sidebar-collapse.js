/* CONUTWAY SIDEBAR COLLAPSIBLE PREMIUM V1 */
(() => {
  const STORAGE_KEY = 'conutway.sidebar.collapsed.v1';
  const DESKTOP_QUERY = '(min-width: 981px)';
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

  const readPreference = () => {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; }
    catch (_) { return false; }
  };

  const savePreference = (collapsed) => {
    try { localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0'); }
    catch (_) {}
  };

  const init = () => {
    const sidebar = document.getElementById('workspaceSidebar') || document.querySelector('.sidebar');
    if (!sidebar || document.getElementById('sidebarCollapseBtn')) return;

    const media = window.matchMedia(DESKTOP_QUERY);
    const moduleButtons = [...sidebar.querySelectorAll('.module-nav button[data-module-target]')];

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

    const applyState = (collapsed, persist = false) => {
      const effective = Boolean(collapsed && media.matches);
      document.body.classList.toggle('sidebar-collapsed', effective);
      document.body.dataset.sidebarState = effective ? 'collapsed' : 'expanded';
      toggle.setAttribute('aria-expanded', String(!effective));
      toggle.setAttribute('aria-label', effective ? 'Expandir menu lateral' : 'Recolher menu lateral');
      toggle.setAttribute('title', effective ? 'Expandir menu lateral' : 'Recolher menu lateral');
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

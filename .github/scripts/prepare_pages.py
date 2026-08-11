#!/usr/bin/env python3
from __future__ import annotations

import base64
from pathlib import Path
import re
import shutil
import sys


def replace_once(text: str, old: str, new: str, label: str) -> str:
    # O pacote pode já conter parte das adaptações do Pages.
    # Nesse caso, não devemos tratar a alteração já aplicada como erro.
    if new in text:
        return text
    if old not in text:
        raise RuntimeError(f"Trecho esperado não encontrado ({label}).")
    return text.replace(old, new, 1)


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "_site")
    base = "/conutway/"
    app_path = root / "app.js"
    index_path = root / "index.html"
    style_path = root / "styles.css"
    login_template_path = repo_root / ".github" / "pages" / "login-template.html"

    for required in (app_path, index_path, style_path, login_template_path):
        if not required.is_file():
            raise FileNotFoundError(f"Arquivo obrigatório não encontrado: {required}")

    app = app_path.read_text(encoding="utf-8")
    app = replace_once(
        app,
        'const DB_VERSION = 7;',
        'const DB_VERSION = 8;',
        "versão do IndexedDB para documentos locais",
    )
    app = replace_once(
        app,
        'const STORES = ["customers", "suppliers", "products", "purchaseOrders", "projects", "contracts", "projectAccounts", "internalRfqs", "rfqSyncState", "inventory", "sellers", "users", "optionGroups", "costProfiles"];',
        'const STORES = ["customers", "suppliers", "products", "purchaseOrders", "projects", "contracts", "projectAccounts", "internalRfqs", "rfqSyncState", "inventory", "sellers", "users", "optionGroups", "costProfiles", "documents"];',
        "store local de documentos",
    )
    app = replace_once(
        app,
        'const serverStorageAllowed = () => ["http:", "https:"].includes(window.location.protocol);',
        "const serverStorageAllowed = () => false;",
        "modo de armazenamento",
    )
    app = replace_once(
        app,
        'currentUser: { id: "", username: "", name: "", role: "member", disabled: false, note: "", permissions: [] },',
        'currentUser: { id: "pages-admin", username: "admin", name: "Administrador", role: "admin", disabled: false, note: "GitHub Pages", permissions: ["all"] },',
        "usuário administrador local",
    )
    app = replace_once(
        app,
        'activeUserSurface: "auth",',
        'activeUserSurface: "roster",',
        "superfície de usuários compatível com Pages",
    )
    app = replace_once(
        app,
        'function canCurrentUserAccessModule(moduleName = "") {\n  if (window.BrErpPermissions?.canAccessModule) return window.BrErpPermissions.canAccessModule(currentAuthUser(), moduleName);',
        'function canCurrentUserAccessModule(moduleName = "") {\n  if (moduleName === "internalRfqs") return false;\n  if (window.BrErpPermissions?.canAccessModule) return window.BrErpPermissions.canAccessModule(currentAuthUser(), moduleName);',
        "módulos compatíveis",
    )
    app = replace_once(
        app,
        "  const authVisible = isCurrentUserAdmin();",
        "  const authVisible = isCurrentUserAdmin() && serverStorageAllowed();",
        "administração de autenticação somente com backend",
    )
    app = replace_once(
        app,
        "if (!productId) return true;\n  try {\n    const response = await fetch(`/api/products/${encodeURIComponent(productId)}/sync`, {",
        "if (!productId || !serverStorageAllowed()) return true;\n  try {\n    const response = await fetch(`/api/products/${encodeURIComponent(productId)}/sync`, {",
        "sincronização de produto",
    )

    seed_anchor = "  for (const store of STORES) loaded[store] = await api.all(store);\n"
    seed_lines = [
        "  for (const store of STORES) loaded[store] = await api.all(store);",
        "",
        "  // No GitHub Pages, cada navegador usa seu próprio IndexedDB.",
        "  // Na primeira abertura, inicializamos os dados demonstrativos já existentes no ERP.",
        "  if (!STORES.some((store) => Array.isArray(loaded[store]) && loaded[store].length > 0)) {",
        "    for (const store of STORES) {",
        "      const initialRecords = Array.isArray(seedData[store])",
        "        ? seedData[store].map((record) => normalizeStablePersistedRecord(record, store))",
        "        : [];",
        "      if (!initialRecords.length) continue;",
        "      await indexedDbApi.replace(store, initialRecords);",
        "      loaded[store] = await indexedDbApi.all(store);",
        "    }",
        "  }",
        "",
    ]
    seed_block = "\n".join(seed_lines)
    app = replace_once(app, seed_anchor, seed_block, "dados iniciais")

    # Documentos e Manuais no Pages: o backend /api/documents não existe no GitHub Pages.
    # Mantemos a mesma interface e operações, mas persistimos os arquivos no IndexedDB
    # do navegador. Isso torna o módulo funcional no ambiente demonstrativo sem servidor.
    documents_pages_adapter = r'''

/* CONUTWAY PAGES DOCUMENTS LOCAL V1 */
const pagesDocumentObjectUrls = new Map();

function pagesDocumentId(prefix = "doc") {
  if (typeof crypto.randomUUID === "function") return `${prefix}-${crypto.randomUUID().replaceAll("-", "")}`;
  return `${prefix}-${Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function pagesBase64ToBlob(base64Value = "", mimeType = "application/octet-stream") {
  const binary = atob(String(base64Value || ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType || "application/octet-stream" });
}

function pagesClearDocumentObjectUrls(documentId = "") {
  for (const [key, url] of pagesDocumentObjectUrls.entries()) {
    if (!documentId || key.startsWith(`${documentId}:`)) {
      try { URL.revokeObjectURL(url); } catch (_) {}
      pagesDocumentObjectUrls.delete(key);
    }
  }
}

async function pagesReadDocuments() {
  const records = await api.all("documents");
  return Array.isArray(records) ? records.map((record) => normalizeDocumentRecord(record)) : [];
}

async function pagesWriteDocuments(records = []) {
  const prepared = (Array.isArray(records) ? records : []).map((record) => ({
    ...record,
    id: String(record.id || record.documentId || pagesDocumentId("doc")),
    documentId: String(record.documentId || record.id || ""),
  })).map((record) => ({ ...record, documentId: record.documentId || record.id }));
  await api.replace("documents", prepared);
  return prepared;
}

function pagesFilterDocuments(records = [], filters = {}) {
  const query = String(filters.query || "").trim().toLocaleLowerCase();
  const category = String(filters.category || "");
  const ctCode = String(filters.ctCode || "").trim().toLocaleLowerCase();
  return records.filter((record) => {
    if (!filters.includeArchived && record.archived) return false;
    if (category && record.category !== category) return false;
    if (ctCode && !String(record.ctCode || "").toLocaleLowerCase().includes(ctCode)) return false;
    if (query) {
      const haystack = [record.name, record.ctCode, record.category, record.product, record.note]
        .map((value) => String(value || "").toLocaleLowerCase()).join(" ");
      if (!haystack.includes(query)) return false;
    }
    return true;
  }).sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
}

const serverDocumentVersionUrl = documentVersionUrl;
documentVersionUrl = function pagesDocumentVersionUrl(record, action) {
  if (serverStorageAllowed()) return serverDocumentVersionUrl(record, action);
  const version = record?.latestVersion;
  if (!record?.documentId || !version?.versionId || !version?.contentBase64) return "";
  const key = `${record.documentId}:${version.versionId}`;
  if (!pagesDocumentObjectUrls.has(key)) {
    const blob = pagesBase64ToBlob(version.contentBase64, version.mimeType || "application/octet-stream");
    pagesDocumentObjectUrls.set(key, URL.createObjectURL(blob));
  }
  return pagesDocumentObjectUrls.get(key) || "";
};

const serverLoadDocuments = loadDocuments;
loadDocuments = async function pagesLoadDocuments() {
  if (serverStorageAllowed()) return serverLoadDocuments();
  state.documentsLoading = true;
  state.documentError = "";
  renderDocuments();
  try {
    const records = await pagesReadDocuments();
    state.documents = pagesFilterDocuments(records, state.documentFilters);
    if (!state.documents.some((record) => record.documentId === state.currentDocumentId)) {
      state.currentDocumentId = state.documents[0]?.documentId || "";
    }
    return state.documents;
  } catch (error) {
    console.error("documents_local_load_failed", error);
    state.documents = [];
    state.currentDocumentId = "";
    state.documentError = t("Não foi possível carregar os documentos.");
    return [];
  } finally {
    state.documentsLoading = false;
    renderDocuments();
    applyLanguage();
  }
};

const serverUploadDocumentChunks = uploadDocumentChunks;
uploadDocumentChunks = async function pagesUploadDocumentChunks(file, metadata = {}, documentId = "") {
  if (serverStorageAllowed()) return serverUploadDocumentChunks(file, metadata, documentId);
  validateDocumentUploadFile(file);
  const records = await pagesReadDocuments();
  const now = new Date().toISOString();
  const sha256 = await documentFileSha256(file);
  const contentBase64 = await documentChunkBase64(file);
  const versionId = pagesDocumentId("ver");
  const latestVersion = {
    versionId,
    fileName: String(file.name || metadata.name || "documento"),
    mimeType: String(file.type || "application/octet-stream"),
    size: Number(file.size) || 0,
    fileSize: Number(file.size) || 0,
    sha256,
    createdAt: now,
    updatedAt: now,
    contentBase64,
  };

  if (documentId) {
    const index = records.findIndex((record) => record.documentId === documentId);
    if (index < 0) throw new Error("Document not found");
    pagesClearDocumentObjectUrls(documentId);
    const updated = {
      ...records[index],
      id: records[index].id || records[index].documentId,
      documentId: records[index].documentId,
      updatedAt: now,
      versionCount: Math.max(0, Number(records[index].versionCount) || 0) + 1,
      latestVersion,
    };
    records[index] = updated;
    await pagesWriteDocuments(records);
    return latestVersion;
  }

  const newDocumentId = pagesDocumentId("doc");
  const created = {
    id: newDocumentId,
    documentId: newDocumentId,
    name: String(metadata.name || file.name || "Documento"),
    category: String(metadata.category || "other"),
    ctCode: String(metadata.ctCode || ""),
    product: "",
    note: "",
    archived: false,
    createdAt: now,
    updatedAt: now,
    versionCount: 1,
    latestVersion,
  };
  records.push(created);
  await pagesWriteDocuments(records);
  return created;
};

const serverRenameDocument = renameDocument;
renameDocument = async function pagesRenameDocument() {
  if (serverStorageAllowed()) return serverRenameDocument();
  const selected = currentDocument();
  if (!selected) return false;
  const name = window.prompt(t("Novo nome"), selected.name)?.trim();
  if (!name || name === selected.name) return false;
  const records = await pagesReadDocuments();
  const index = records.findIndex((record) => record.documentId === selected.documentId);
  if (index < 0) return false;
  records[index] = { ...records[index], name, updatedAt: new Date().toISOString() };
  await pagesWriteDocuments(records);
  await loadDocuments();
  return true;
};

const serverToggleDocumentArchive = toggleDocumentArchive;
toggleDocumentArchive = async function pagesToggleDocumentArchive(archived) {
  if (serverStorageAllowed()) return serverToggleDocumentArchive(archived);
  const selected = currentDocument();
  if (!selected || !window.confirm(t(archived ? "Arquivar este documento?" : "Restaurar este documento?"))) return false;
  const records = await pagesReadDocuments();
  const index = records.findIndex((record) => record.documentId === selected.documentId);
  if (index < 0) return false;
  records[index] = { ...records[index], archived: Boolean(archived), updatedAt: new Date().toISOString() };
  await pagesWriteDocuments(records);
  await loadDocuments();
  return true;
};

const serverDeleteDocument = deleteDocument;
deleteDocument = async function pagesDeleteDocument() {
  if (serverStorageAllowed()) return serverDeleteDocument();
  const selected = currentDocument();
  if (!selected || !window.confirm(t("Excluir este documento permanentemente?"))) return false;
  const records = await pagesReadDocuments();
  pagesClearDocumentObjectUrls(selected.documentId);
  await pagesWriteDocuments(records.filter((record) => record.documentId !== selected.documentId));
  state.currentDocumentId = "";
  await loadDocuments();
  return true;
};
'''
    initialize_anchor = "async function initializeApplication() {"
    if "CONUTWAY PAGES DOCUMENTS LOCAL V1" not in app:
        if initialize_anchor not in app:
            raise RuntimeError("Ponto de injeção do adaptador local de documentos não encontrado.")
        app = app.replace(initialize_anchor, documents_pages_adapter + "\n\n" + initialize_anchor, 1)

    app_path.write_text(app, encoding="utf-8")

    html = index_path.read_text(encoding="utf-8")
    if "<base " not in html.lower():
        html = re.sub(
            r"(<head(?:\s[^>]*)?>)",
            rf'\1\n    <base href="{base}">',
            html,
            count=1,
            flags=re.IGNORECASE,
        )

    auth_guard = """<script id="pagesAuthGuard">
      (() => {
        const AUTH_KEY = 'conutway.auth.v1';
        const MAX_AGE = 12 * 60 * 60 * 1000;
        const root = document.documentElement;
        root.style.visibility = 'hidden';
        try {
          const raw = sessionStorage.getItem(AUTH_KEY);
          const auth = raw ? JSON.parse(raw) : null;
          const valid = auth?.user === 'admin' && Number.isFinite(auth?.issuedAt) && (Date.now() - auth.issuedAt) < MAX_AGE;
          if (valid) {
            root.style.visibility = '';
            return;
          }
        } catch (_) {}
        sessionStorage.removeItem(AUTH_KEY);
        window.location.replace('login.html');
      })();
    </script>"""
    if 'id="pagesAuthGuard"' not in html:
        html = re.sub(
            r'(<base\b[^>]*>)',
            lambda match: match.group(1) + "\n    " + auth_guard,
            html,
            count=1,
            flags=re.IGNORECASE,
        )

    banner = (
        '<div class="pages-mode-banner" role="status">'
        '<strong>Ambiente demonstrativo</strong>'
        '<span>Dados salvos localmente neste navegador.</span>'
        "</div>"
    )
    if "pages-mode-banner" not in html:
        html = re.sub(
            r"(<body(?:\s[^>]*)?>)",
            rf"\1\n    {banner}",
            html,
            count=1,
            flags=re.IGNORECASE,
        )

    logout_script = """<script id="pagesLogoutHandler">
      document.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target.closest('#logoutBtn') : null;
        if (!target) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        sessionStorage.removeItem('conutway.auth.v1');
        sessionStorage.removeItem('conutway_pages_auth');
        window.location.replace('login.html');
      }, true);
    </script>"""
    if 'id="pagesLogoutHandler"' not in html:
        html = re.sub(
            r"</body>",
            logout_script + "\n  </body>",
            html,
            count=1,
            flags=re.IGNORECASE,
        )
    index_path.write_text(html, encoding="utf-8")

    login = login_template_path.read_text(encoding="utf-8")
    old_success = "sessionStorage.setItem(KEY,JSON.stringify({username:'admin',at:Date.now()}));location.href='./'"
    new_success = "const now=Date.now();sessionStorage.setItem(KEY,JSON.stringify({username:'admin',at:now}));sessionStorage.setItem('conutway.auth.v1',JSON.stringify({user:'admin',issuedAt:now}));location.href='./'"
    if old_success in login:
        login = login.replace(old_success, new_success, 1)
    elif "sessionStorage.setItem('conutway.auth.v1'" not in login:
        raise RuntimeError("Trecho de autenticação do login não encontrado para alinhar com o workspace.")
    (root / "login.html").write_text(login, encoding="utf-8")

    css = """

.pages-mode-banner {
  position: sticky;
  top: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: .65rem;
  padding: .55rem 1rem;
  border-bottom: 1px solid #bfdbfe;
  background: #eff6ff;
  color: #1e3a5f;
  font-size: .82rem;
  text-align: center;
}
.pages-mode-banner strong { color: #0f4c81; }
@media (max-width: 720px) {
  .pages-mode-banner { align-items: flex-start; flex-direction: column; gap: .15rem; }
}
"""
    style_text = style_path.read_text(encoding="utf-8")
    if ".pages-mode-banner {" not in style_text:
        style_path.write_text(style_text + css, encoding="utf-8")

    assets_dir = root / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    logo_svg = """<svg xmlns="http://www.w3.org/2000/svg" width="520" height="112" viewBox="0 0 520 112" role="img" aria-label="CONUTWAY TEZA">
  <rect width="520" height="112" rx="18" fill="white" fill-opacity="0"/>
  <g transform="translate(8 8)">
    <circle cx="48" cy="48" r="43" fill="#0f4c81"/>
    <path d="M28 49c0-13 9-23 22-23 8 0 14 3 19 9l-9 8c-3-4-6-6-11-6-7 0-12 5-12 12s5 12 12 12c5 0 9-2 12-6l9 8c-5 6-12 10-20 10-13 0-22-11-22-24z" fill="white"/>
    <path d="M67 25h11v47H67z" fill="#69b3e7" opacity=".95"/>
  </g>
  <text x="112" y="58" font-family="Arial, Helvetica, sans-serif" font-size="39" font-weight="700" fill="#16324f" letter-spacing="1.4">CONUTWAY</text>
  <text x="114" y="86" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="600" fill="#0f4c81" letter-spacing="4">TEZA ERP</text>
</svg>"""
    (assets_dir / "conutway-teza-logo-crop.svg").write_text(logo_svg, encoding="utf-8")

    png_1x1 = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl9ZVQAAAAASUVORK5CYII="
    )
    (assets_dir / "conutway-teza-logo-crop.png").write_bytes(png_1x1)
    (assets_dir / "ct-mark.png").write_bytes(png_1x1)

    text_extensions = {
        ".html", ".htm", ".css", ".js", ".mjs", ".json",
        ".webmanifest", ".xml", ".svg", ".txt",
    }
    asset_replacements = {
        "assets/conutway-teza-logo-crop.png": "assets/conutway-teza-logo-crop.svg",
        "assets/ct-mark.png": "assets/conutway-teza-logo-crop.svg",
    }
    path_replacements = {
        'src="/assets/': f'src="{base}assets/',
        "src='/assets/": f"src='{base}assets/",
        'href="/assets/': f'href="{base}assets/',
        "href='/assets/": f"href='{base}assets/",
        "url(/assets/": f"url({base}assets/",
        'src="/static/': f'src="{base}static/',
        "src='/static/": f"src='{base}static/",
        'href="/static/': f'href="{base}static/',
        "href='/static/": f"href='{base}static/",
        "url(/static/": f"url({base}static/",
        'href="/favicon': f'href="{base}favicon',
        "href='/favicon": f"href='{base}favicon",
        'href="/manifest': f'href="{base}manifest',
        "href='/manifest": f"href='{base}manifest",
    }

    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in text_extensions:
            continue
        try:
            original = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        changed = original
        for old, new in asset_replacements.items():
            changed = changed.replace(old, new)
        for old, new in path_replacements.items():
            changed = changed.replace(old, new)
        if path.name in {"manifest.json", "site.webmanifest", "manifest.webmanifest"}:
            changed = re.sub(r'("start_url"\s*:\s*")/("?)', rf"\1{base}\2", changed)
            changed = re.sub(r'("scope"\s*:\s*")/("?)', rf"\1{base}\2", changed)
        if changed != original:
            path.write_text(changed, encoding="utf-8")

    shutil.copy2(index_path, root / "404.html")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

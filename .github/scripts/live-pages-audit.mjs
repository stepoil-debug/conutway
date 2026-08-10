import { chromium } from "playwright";
import fs from "node:fs";

const BASE_URL = "https://stepoil-debug.github.io/conutway/";
const EXPECTED_MODULES = [
  "dashboard",
  "customers",
  "projects",
  "contracts",
  "projectAccounts",
  "suppliers",
  "purchaseOrders",
  "inventory",
  "products",
  "options",
  "sellers",
  "users",
];
const REQUIRED_RESOURCES = [
  "app.js",
  "styles.css",
  "storage.js",
  "permissions.js",
];
const OPTIONAL_VISUAL_RESOURCES = [
  "assets/ct-mark.png",
  "assets/conutway-teza-logo-crop.png",
];

const report = {
  url: BASE_URL,
  startedAt: new Date().toISOString(),
  title: "",
  rootStatus: null,
  modules: [],
  resources: [],
  images: [],
  storage: {},
  consoleErrors: [],
  pageErrors: [],
  requestFailures: [],
  httpErrors: [],
  assertions: [],
};
const failures = [];

function assertOk(condition, message, details = {}) {
  const ok = Boolean(condition);
  report.assertions.push({ ok, message, ...details });
  if (!ok) failures.push(message);
}
function sameSite(url = "") {
  return url.startsWith(BASE_URL);
}
function uniq(items) {
  return [...new Set(items)];
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  ignoreHTTPSErrors: false,
});
const page = await context.newPage();
page.setDefaultTimeout(8000);
page.setDefaultNavigationTimeout(30000);

page.on("console", (msg) => {
  if (msg.type() === "error") report.consoleErrors.push(msg.text());
});
page.on("pageerror", (error) => report.pageErrors.push(String(error?.stack || error)));
page.on("requestfailed", (request) => {
  if (!sameSite(request.url())) return;
  report.requestFailures.push({
    url: request.url(),
    method: request.method(),
    error: request.failure()?.errorText || "request failed",
  });
});
page.on("response", (response) => {
  if (!sameSite(response.url()) || response.status() < 400) return;
  report.httpErrors.push({ url: response.url(), status: response.status() });
});

try {
  const response = await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  report.rootStatus = response?.status() ?? null;
  assertOk(Boolean(response), "A página principal deve responder.");
  assertOk((response?.status() || 0) < 400, `A página principal respondeu HTTP ${response?.status() || "sem resposta"}.`);
  await page.waitForTimeout(2000);

  report.title = await page.title();
  assertOk(report.title.includes("CONUTWAY"), `Título inesperado: ${report.title}`);

  const pageText = (await page.locator("body").innerText()).slice(0, 16000);
  assertOk(!/There isn't a GitHub Pages site here/i.test(pageText), "O GitHub Pages está exibindo a tela padrão de 404.");
  assertOk(!/^\s*404\s*$/m.test(pageText), "Foi encontrado um 404 visível na página principal.");

  const baseHref = await page.locator("base").getAttribute("href").catch(() => null);
  assertOk(baseHref === "/conutway/", `Base href incorreto: ${baseHref}`);

  for (const resource of REQUIRED_RESOURCES) {
    const url = new URL(resource, BASE_URL).href;
    const res = await context.request.get(url, { timeout: 15000, failOnStatusCode: false });
    const item = { resource, url, status: res.status(), contentType: res.headers()["content-type"] || "" };
    report.resources.push(item);
    assertOk(res.status() >= 200 && res.status() < 400, `Recurso obrigatório indisponível: ${resource} (HTTP ${res.status()})`);
  }
  for (const resource of OPTIONAL_VISUAL_RESOURCES) {
    const url = new URL(resource, BASE_URL).href;
    const res = await context.request.get(url, { timeout: 15000, failOnStatusCode: false });
    report.resources.push({ resource, url, status: res.status(), contentType: res.headers()["content-type"] || "", optional: true });
  }

  const imageState = await page.locator("img").evaluateAll((images) => images.map((img) => ({
    src: img.currentSrc || img.src,
    alt: img.alt || "",
    complete: img.complete,
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
    hidden: Boolean(img.hidden),
  })));
  report.images = imageState;
  for (const image of imageState) {
    if (!image.src.startsWith(BASE_URL) || image.hidden) continue;
    assertOk(image.complete && image.naturalWidth > 0, `Imagem visível não carregou: ${image.src}`);
  }

  const storageLabel = await page.locator("#storageModeLabel").textContent().catch(() => "");
  report.storage.label = String(storageLabel || "").trim();
  assertOk(/local/i.test(report.storage.label), `Modo de armazenamento inesperado: ${report.storage.label}`);

  const databaseState = await page.evaluate(async () => {
    const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error(`IndexedDB timeout ${ms}ms`)), ms));
    const inspect = async () => {
      const names = typeof indexedDB.databases === "function"
        ? (await indexedDB.databases()).map((db) => db.name).filter(Boolean)
        : [];
      const dbName = "conutway-teza-commercial-data";
      const stores = await new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onerror = () => reject(request.error || new Error("Falha ao abrir IndexedDB"));
        request.onblocked = () => reject(new Error("IndexedDB bloqueado"));
        request.onsuccess = () => {
          const db = request.result;
          const result = Array.from(db.objectStoreNames);
          db.close();
          resolve(result);
        };
      });
      return { names, stores };
    };
    return Promise.race([inspect(), timeout(5000)]);
  }).catch((error) => ({ error: String(error) }));
  report.storage.databases = databaseState.names || [];
  report.storage.objectStores = databaseState.stores || [];
  report.storage.error = databaseState.error || "";
  assertOk(!databaseState.error, `Falha no IndexedDB: ${databaseState.error || ""}`);
  assertOk((databaseState.stores || []).length > 0, "O banco IndexedDB local não possui object stores.");

  const backendState = await page.evaluate(() => {
    const state = {};
    for (const name of ["documents", "internalRfqs"]) {
      const el = document.querySelector(`[data-module-target="${name}"]`);
      if (!el) state[name] = { missing: true };
      else {
        const css = getComputedStyle(el);
        state[name] = { hidden: el.hidden, display: css.display, visibility: css.visibility, disabled: Boolean(el.disabled) };
      }
    }
    return state;
  });
  for (const name of ["documents", "internalRfqs"]) {
    const s = backendState[name] || {};
    const effectivelyHidden = s.missing || s.hidden || s.display === "none" || s.visibility === "hidden";
    assertOk(effectivelyHidden, `O módulo ${name} deve ficar oculto no GitHub Pages sem backend.`, { backendState });
  }

  const discoveredModules = await page.locator("[data-module-target]").evaluateAll((els) => els.map((el) => ({
    module: el.getAttribute("data-module-target"),
    hidden: el.hidden,
    display: getComputedStyle(el).display,
    visibility: getComputedStyle(el).visibility,
    disabled: Boolean(el.disabled),
  })));
  report.discoveredModules = discoveredModules;

  for (const moduleName of EXPECTED_MODULES) {
    const selector = `[data-module-target="${moduleName}"]`;
    const button = page.locator(selector).first();
    if (!(await button.count())) {
      report.modules.push({ module: moduleName, ok: false, reason: "button missing" });
      failures.push(`Botão do módulo não encontrado: ${moduleName}`);
      continue;
    }
    const availability = await button.evaluate((el) => {
      const css = getComputedStyle(el);
      return { hidden: el.hidden, display: css.display, visibility: css.visibility, disabled: Boolean(el.disabled) };
    });
    if (availability.hidden || availability.display === "none" || availability.visibility === "hidden" || availability.disabled) {
      report.modules.push({ module: moduleName, ok: false, reason: "button unavailable", availability });
      failures.push(`Módulo esperado indisponível: ${moduleName}`);
      continue;
    }

    // Dispara o clique no próprio DOM para auditar a navegação sem depender de
    // geometria/overlays do runner headless.
    await button.evaluate((el) => el.click());
    await page.waitForTimeout(180);
    const state = await page.evaluate((name) => {
      const pageEl = document.getElementById(name);
      const activeNodes = [...document.querySelectorAll(".page.active, [data-page].active")].map((el) => el.id || el.getAttribute("data-page"));
      const title = document.querySelector("#moduleTitle")?.textContent?.trim() || "";
      return { exists: Boolean(pageEl), active: Boolean(pageEl?.classList.contains("active")), title, activeNodes };
    }, moduleName);
    const ok = state.exists && state.active;
    report.modules.push({ module: moduleName, ok, ...state });
    assertOk(ok, `Falha ao navegar para o módulo ${moduleName}.`, { state });
  }

  const usersSurface = await page.evaluate(() => ({
    authVisible: [...document.querySelectorAll('#users [data-user-surface="auth"]')].some((el) => !el.hidden && getComputedStyle(el).display !== "none"),
    nasVisible: [...document.querySelectorAll('#users [data-admin-only="nas-status"]')].some((el) => !el.hidden && getComputedStyle(el).display !== "none"),
    rosterVisible: [...document.querySelectorAll('#users [data-user-surface="roster"]')].some((el) => !el.hidden && getComputedStyle(el).display !== "none"),
    logoutVisible: (() => {
      const el = document.querySelector("#logoutBtn");
      return Boolean(el && !el.hidden && getComputedStyle(el).display !== "none");
    })(),
  }));
  report.usersSurface = usersSurface;
  assertOk(!usersSurface.authVisible, "Administração de autenticação não deve aparecer sem backend.");
  assertOk(!usersSurface.logoutVisible, "Botão Sair não deve aparecer no modo local do GitHub Pages.");

  const brokenAnchors = await page.locator("a[href]").evaluateAll((anchors, base) => anchors
    .map((a) => ({ text: (a.textContent || "").trim(), href: a.href }))
    .filter((a) => a.href.startsWith(base) && /\/api\//.test(a.href)), BASE_URL);
  report.backendAnchors = brokenAnchors;
  assertOk(brokenAnchors.length === 0, "Há links visíveis apontando para rotas /api/ sem backend.", { brokenAnchors });

  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1000);
  const afterReloadTitle = await page.title();
  assertOk(afterReloadTitle.includes("CONUTWAY"), "A aplicação não retornou corretamente após recarregar a página.");
  await page.screenshot({ path: "live-pages-audit.png", fullPage: true });
} catch (error) {
  failures.push(`Erro fatal da auditoria: ${String(error?.stack || error)}`);
} finally {
  report.finishedAt = new Date().toISOString();
  report.consoleErrors = uniq(report.consoleErrors);
  report.pageErrors = uniq(report.pageErrors);
  report.failures = failures;
  fs.writeFileSync("live-pages-audit.json", JSON.stringify(report, null, 2));
  await browser.close();
}

const runtimeProblems = [
  ...report.consoleErrors.map((error) => `console.error: ${error}`),
  ...report.pageErrors.map((error) => `pageerror: ${error}`),
  ...report.requestFailures.map((error) => `requestfailed: ${error.method} ${error.url} - ${error.error}`),
  ...report.httpErrors.map((error) => `HTTP ${error.status}: ${error.url}`),
];
if (runtimeProblems.length) failures.push(...runtimeProblems);

if (failures.length) {
  console.error(JSON.stringify({ failures, report }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, report }, null, 2));

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
  "assets/ct-mark.png",
  "assets/conutway-teza-logo-crop.png",
];

const report = {
  url: BASE_URL,
  startedAt: new Date().toISOString(),
  title: "",
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
  report.assertions.push({ ok: Boolean(condition), message, ...details });
  if (!condition) failures.push(message);
}
function sameSite(url = "") {
  return url.startsWith(BASE_URL);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  ignoreHTTPSErrors: false,
});
const page = await context.newPage();

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
  const response = await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  assertOk(Boolean(response), "A página principal deve responder.");
  assertOk((response?.status() || 0) < 400, `A página principal respondeu HTTP ${response?.status() || "sem resposta"}.`);
  await page.waitForTimeout(2500);

  report.title = await page.title();
  assertOk(report.title.includes("CONUTWAY"), `Título inesperado: ${report.title}`);

  const pageText = (await page.locator("body").innerText()).slice(0, 12000);
  assertOk(!/There isn't a GitHub Pages site here/i.test(pageText), "O GitHub Pages ainda está exibindo a tela padrão de 404.");
  assertOk(!/^\s*404\s*$/m.test(pageText), "Foi encontrado um 404 visível na página principal.");

  const baseHref = await page.locator("base").getAttribute("href").catch(() => null);
  assertOk(baseHref === "/conutway/", `Base href incorreto: ${baseHref}`);

  for (const resource of REQUIRED_RESOURCES) {
    const url = new URL(resource, BASE_URL).href;
    const res = await context.request.get(url, { timeout: 30000, failOnStatusCode: false });
    const item = {
      resource,
      url,
      status: res.status(),
      contentType: res.headers()["content-type"] || "",
    };
    report.resources.push(item);
    assertOk(res.status() >= 200 && res.status() < 400, `Recurso obrigatório indisponível: ${resource} (HTTP ${res.status()})`);
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
    if (!image.src.startsWith(BASE_URL)) continue;
    assertOk(image.complete && image.naturalWidth > 0, `Imagem não carregou: ${image.src}`);
  }

  const storageLabel = await page.locator("#storageModeLabel").textContent().catch(() => "");
  report.storage.label = String(storageLabel || "").trim();
  assertOk(/local/i.test(report.storage.label), `Modo de armazenamento inesperado: ${report.storage.label}`);

  const databaseState = await page.evaluate(async () => {
    const names = typeof indexedDB.databases === "function"
      ? (await indexedDB.databases()).map((db) => db.name).filter(Boolean)
      : [];
    const dbName = "conutway-teza-commercial-data";
    const stores = await new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName);
      request.onerror = () => reject(request.error || new Error("Falha ao abrir IndexedDB"));
      request.onsuccess = () => {
        const db = request.result;
        const result = Array.from(db.objectStoreNames);
        db.close();
        resolve(result);
      };
    });
    return { names, stores };
  });
  report.storage.databases = databaseState.names;
  report.storage.objectStores = databaseState.stores;
  assertOk(databaseState.stores.length > 0, "O banco IndexedDB local não possui object stores.");

  const hiddenBackendModules = await page.evaluate(() => {
    const result = {};
    for (const name of ["documents", "internalRfqs"]) {
      const button = document.querySelector(`[data-module-target="${name}"]`);
      result[name] = button ? { hidden: button.hidden, disabled: button.disabled } : { missing: true };
    }
    return result;
  });
  assertOk(hiddenBackendModules.documents?.hidden === true, "O módulo Documentos deve ficar oculto no GitHub Pages sem backend.", { hiddenBackendModules });
  assertOk(hiddenBackendModules.internalRfqs?.hidden === true, "O módulo RFQ Interno deve ficar oculto no GitHub Pages sem backend.", { hiddenBackendModules });

  for (const moduleName of EXPECTED_MODULES) {
    const selector = `[data-module-target="${moduleName}"]`;
    const button = page.locator(selector).first();
    const count = await button.count();
    if (!count) {
      report.modules.push({ module: moduleName, ok: false, reason: "button missing" });
      failures.push(`Botão do módulo não encontrado: ${moduleName}`);
      continue;
    }
    const hidden = await button.evaluate((el) => Boolean(el.hidden));
    if (hidden) {
      report.modules.push({ module: moduleName, ok: false, reason: "button hidden" });
      failures.push(`Módulo esperado está oculto: ${moduleName}`);
      continue;
    }

    await button.click();
    await page.waitForTimeout(300);
    const state = await page.evaluate((name) => {
      const pageEl = document.getElementById(name);
      const title = document.querySelector("#moduleTitle")?.textContent?.trim() || "";
      return {
        exists: Boolean(pageEl),
        active: Boolean(pageEl?.classList.contains("active")),
        title,
      };
    }, moduleName);
    const ok = state.exists && state.active;
    report.modules.push({ module: moduleName, ok, ...state });
    assertOk(ok, `Falha ao navegar para o módulo ${moduleName}.`, { state });
  }

  const usersSurface = await page.evaluate(() => ({
    authVisible: Array.from(document.querySelectorAll('#users [data-user-surface="auth"]')).some((el) => !el.hidden),
    nasVisible: Array.from(document.querySelectorAll('#users [data-admin-only="nas-status"]')).some((el) => !el.hidden),
    rosterVisible: Array.from(document.querySelectorAll('#users [data-user-surface="roster"]')).some((el) => !el.hidden),
    logoutVisible: (() => {
      const el = document.querySelector("#logoutBtn");
      return Boolean(el && !el.hidden);
    })(),
  }));
  report.usersSurface = usersSurface;

  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1500);
  const afterReloadTitle = await page.title();
  assertOk(afterReloadTitle.includes("CONUTWAY"), "A aplicação não retornou corretamente após recarregar a página.");

  await page.screenshot({ path: "live-pages-audit.png", fullPage: true });
} catch (error) {
  failures.push(`Erro fatal da auditoria: ${String(error?.stack || error)}`);
} finally {
  report.finishedAt = new Date().toISOString();
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

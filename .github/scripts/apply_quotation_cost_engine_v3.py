#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import re
import shutil
import subprocess
import sys

ENGINE_MARKER = "CONUTWAY QUOTATION COST ENGINE V3"
AUTO_MARKER = "CONUTWAY QUOTATION COST ENGINE V3 AUTO DEFAULT"
NCM_SYNC_MARKER = "CONUTWAY QUOTATION NCM TAX SYNC V1"
CSS_MARKER = "CONUTWAY QUOTATION COST ENGINE V3"
NCM_CSS_MARKER = "CONUTWAY QUOTATION NCM TAX SYNC V1"
LINK_MARKER = 'data-conutway-cost-engine="v3"'
NCM_LINK_MARKER = 'data-conutway-ncm-tax-sync="v1"'


def inject_css_links(html: str) -> str:
    links = []
    if LINK_MARKER not in html:
        links.append('<link rel="stylesheet" href="assets/quotation-cost-engine-v3.css" data-conutway-cost-engine="v3">')
    if NCM_LINK_MARKER not in html:
        links.append('<link rel="stylesheet" href="assets/quotation-ncm-tax-sync-v1.css" data-conutway-ncm-tax-sync="v1">')
    if not links:
        return html
    if "</head>" not in html.lower():
        raise RuntimeError("Fechamento </head> não encontrado para injetar CSS do motor de custos.")
    return re.sub(r"</head>", "  " + "\n  ".join(links) + "\n</head>", html, count=1, flags=re.IGNORECASE)


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "_site").resolve()
    app_path = root / "app.js"
    index_path = root / "index.html"
    fallback_path = root / "404.html"
    assets = root / "assets"

    engine_source = repo_root / ".github" / "pages" / "quotation-cost-engine-v3.js"
    auto_source = repo_root / ".github" / "pages" / "quotation-cost-engine-v3-autodefault.js"
    ncm_sync_source = repo_root / ".github" / "pages" / "quotation-ncm-tax-sync-v1.js"
    css_source = repo_root / ".github" / "pages" / "quotation-cost-engine-v3.css"
    ncm_css_source = repo_root / ".github" / "pages" / "quotation-ncm-tax-sync-v1.css"
    catalog_source = repo_root / ".github" / "pages" / "cost-catalog-v3.json"

    required = [app_path, index_path, fallback_path, engine_source, auto_source, ncm_sync_source, css_source, ncm_css_source, catalog_source]
    for path in required:
        if not path.is_file() or path.stat().st_size == 0:
            raise FileNotFoundError(f"Arquivo obrigatório do motor V3 não encontrado: {path}")

    engine = engine_source.read_text(encoding="utf-8")
    auto = auto_source.read_text(encoding="utf-8")
    ncm_sync = ncm_sync_source.read_text(encoding="utf-8")
    css = css_source.read_text(encoding="utf-8")
    ncm_css = ncm_css_source.read_text(encoding="utf-8")
    if ENGINE_MARKER not in engine or AUTO_MARKER not in auto or NCM_SYNC_MARKER not in ncm_sync or CSS_MARKER not in css or NCM_CSS_MARKER not in ncm_css:
        raise RuntimeError("Marcadores do motor V3/NCM não encontrados nos arquivos-fonte.")

    app = app_path.read_text(encoding="utf-8")
    anchor = "async function initializeApplication() {"
    if ENGINE_MARKER not in app:
        if anchor not in app:
            raise RuntimeError("Ponto de injeção initializeApplication não encontrado em app.js.")
        injected = f"\n\n{engine}\n\n{auto}\n\n{ncm_sync}\n\n"
        app = app.replace(anchor, injected + anchor, 1)
        app_path.write_text(app, encoding="utf-8")
    else:
        additions = []
        if AUTO_MARKER not in app:
            additions.append(auto)
        if NCM_SYNC_MARKER not in app:
            additions.append(ncm_sync)
        if additions:
            if anchor not in app:
                raise RuntimeError("Ponto de injeção initializeApplication não encontrado para extensões V3.")
            app = app.replace(anchor, "\n\n" + "\n\n".join(additions) + "\n\n" + anchor, 1)
            app_path.write_text(app, encoding="utf-8")

    assets.mkdir(parents=True, exist_ok=True)
    shutil.copy2(css_source, assets / "quotation-cost-engine-v3.css")
    shutil.copy2(ncm_css_source, assets / "quotation-ncm-tax-sync-v1.css")
    shutil.copy2(catalog_source, assets / "cost-catalog-v3.json")

    for html_path in (index_path, fallback_path):
        html = html_path.read_text(encoding="utf-8")
        html_path.write_text(inject_css_links(html), encoding="utf-8")

    final_app = app_path.read_text(encoding="utf-8")
    final_index = index_path.read_text(encoding="utf-8")
    checks = {
        "engine": ENGINE_MARKER in final_app,
        "auto": AUTO_MARKER in final_app,
        "ncm_sync": NCM_SYNC_MARKER in final_app,
        "catalog": (assets / "cost-catalog-v3.json").is_file(),
        "css": CSS_MARKER in (assets / "quotation-cost-engine-v3.css").read_text(encoding="utf-8"),
        "ncm_css": NCM_CSS_MARKER in (assets / "quotation-ncm-tax-sync-v1.css").read_text(encoding="utf-8"),
        "css_link": LINK_MARKER in final_index,
        "ncm_css_link": NCM_LINK_MARKER in final_index,
        "official_profile": "cost-rj-rio-brasil-2026-v3" in (assets / "cost-catalog-v3.json").read_text(encoding="utf-8"),
        "terminal_tariff": '"procedureRate": 0.42' in (assets / "cost-catalog-v3.json").read_text(encoding="utf-8"),
        "auto_profile": "conutwayV3ApplyOfficialDefaults" in final_app,
        "detailed_calculation": "conutwayV3DetailedCalculation" in final_app,
        "product_tax_sync": "conutwayNcmApplyFiscalProfile" in final_app,
        "ncm_tax_sync": "conutwayNcmSyncItem" in final_app,
        "product_tax_fields": 'data-product-field=\\"iiRate\\"' in final_app or 'data-product-field="iiRate"' in final_app,
    }
    failed = [name for name, ok in checks.items() if not ok]
    if failed:
        raise RuntimeError("Falha na integração do motor de custos V3/NCM: " + ", ".join(failed))

    subprocess.run(["node", "--check", str(app_path)], check=True)
    print(
        "QUOTATION_COST_ENGINE_V3_OK",
        f"app_bytes={app_path.stat().st_size}",
        f"catalog_bytes={(assets / 'cost-catalog-v3.json').stat().st_size}",
        f"css_bytes={(assets / 'quotation-cost-engine-v3.css').stat().st_size}",
        f"ncm_css_bytes={(assets / 'quotation-ncm-tax-sync-v1.css').stat().st_size}",
        "ncm_tax_sync=v1",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

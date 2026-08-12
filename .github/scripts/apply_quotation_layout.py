#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import re
import shutil
import subprocess
import sys

MARKER = "CONUTWAY QUOTATION LAYOUT V2"
LINK_MARKER = 'data-conutway-quotation-layout="v2"'
ALIGNMENT_MARKER = "CONUTWAY QUOTATION ALIGNMENT V3"
ALIGNMENT_LINK_MARKER = 'data-conutway-quotation-alignment="v3"'
ITEMS_ORDER_MARKER = 'data-pricing-order="items-first-v1"'


def inject_links(html: str) -> str:
    links = []
    if LINK_MARKER not in html:
        links.append('<link rel="stylesheet" href="assets/quotation-layout-v2.css" data-conutway-quotation-layout="v2">')
    if ALIGNMENT_LINK_MARKER not in html:
        links.append('<link rel="stylesheet" href="assets/quotation-alignment-v3.css" data-conutway-quotation-alignment="v3">')
    if not links:
        return html
    if "</head>" not in html.lower():
        raise RuntimeError("Fechamento </head> não encontrado para injetar layout de Cotações.")
    injected = "\n  ".join(links)
    return re.sub(r"</head>", f"  {injected}\n</head>", html, count=1, flags=re.IGNORECASE)


def reorder_pricing_items(html: str) -> str:
    """Coloca os itens logo após Câmbio e perfil e antes dos custos/tributos.

    O bundle legado trazia a ordem Câmbio -> custos -> itens. Como NCM e produto
    são a origem da tributação, o fluxo visual correto é Câmbio -> itens -> custos.
    Fazemos a mudança no HTML do build para preservar eventos e IDs originais.
    """
    if ITEMS_ORDER_MARKER in html:
        return html

    item_pattern = re.compile(
        r'(?P<block>\s*<section class="form-section form-section-items">.*?'
        r'<div class="appendix-editor" id="appendixEditor" hidden></div>\s*</section>)',
        flags=re.DOTALL,
    )
    match = item_pattern.search(html)
    if not match:
        raise RuntimeError("Bloco Itens da cotação não encontrado para reorganização.")

    block = match.group("block")
    block = block.replace(
        '<section class="form-section form-section-items">',
        '<section class="form-section form-section-items" data-pricing-order="items-first-v1">',
        1,
    )
    without_items = html[: match.start()] + html[match.end() :]

    pricing_panel = '<section class="project-pricing-panel" id="projectPricingPanel"></section>'
    panel_index = without_items.find(pricing_panel)
    if panel_index < 0:
        raise RuntimeError("Painel de parâmetros de custo não encontrado para reorganização.")

    # Mantém a indentação do HTML e posiciona os itens imediatamente antes dos
    # parâmetros comerciais. O motor detalhado é injetado depois desse painel,
    # portanto também permanece abaixo dos itens.
    insertion = block.rstrip() + "\n\n                "
    return without_items[:panel_index] + insertion + without_items[panel_index:]


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "_site").resolve()
    source = repo_root / ".github" / "pages" / "quotation-layout-v2.css"
    alignment_source = repo_root / ".github" / "pages" / "quotation-alignment-v3.css"
    index = root / "index.html"
    fallback = root / "404.html"
    assets = root / "assets"

    for required in (source, alignment_source, index, fallback):
        if not required.is_file() or required.stat().st_size == 0:
            raise FileNotFoundError(f"Arquivo obrigatório do layout de Cotações não encontrado: {required}")

    css = source.read_text(encoding="utf-8")
    alignment_css = alignment_source.read_text(encoding="utf-8")
    if MARKER not in css:
        raise RuntimeError("CSS de Cotações não possui o marcador esperado.")
    if ALIGNMENT_MARKER not in alignment_css:
        raise RuntimeError("CSS de alinhamento da Precificação não possui o marcador esperado.")

    assets.mkdir(parents=True, exist_ok=True)
    target = assets / "quotation-layout-v2.css"
    alignment_target = assets / "quotation-alignment-v3.css"
    shutil.copy2(source, target)
    shutil.copy2(alignment_source, alignment_target)

    for path in (index, fallback):
        html = path.read_text(encoding="utf-8")
        html = inject_links(html)
        html = reorder_pricing_items(html)
        path.write_text(html, encoding="utf-8")

    final_index = index.read_text(encoding="utf-8")
    final_css = target.read_text(encoding="utf-8")
    final_alignment_css = alignment_target.read_text(encoding="utf-8")
    checks = {
        "link": LINK_MARKER in final_index,
        "alignment-link": ALIGNMENT_LINK_MARKER in final_index,
        "css": MARKER in final_css,
        "alignment-css": ALIGNMENT_MARKER in final_alignment_css,
        "pricing": "#projects .estimated-cost-profile-bar" in final_css,
        "items": "#projects .quotation-items-editor" in final_css,
        "summary": "#projects #projectPricingSummary" in final_alignment_css,
        "equal-cost-groups": "repeat(2, minmax(0, 1fr))" in final_alignment_css,
        "items-order-marker": ITEMS_ORDER_MARKER in final_index,
        "items-before-costs": final_index.find(ITEMS_ORDER_MARKER) < final_index.find('id="projectPricingPanel"'),
    }
    failed = [name for name, ok in checks.items() if not ok]
    if failed:
        raise RuntimeError("Falha na validação do layout de Cotações: " + ", ".join(failed))

    engine_script = repo_root / ".github" / "scripts" / "apply_quotation_cost_engine_v3.py"
    if not engine_script.is_file():
        raise FileNotFoundError(f"Motor de custos V3 não encontrado: {engine_script}")
    subprocess.run([sys.executable, str(engine_script), str(root)], cwd=repo_root, check=True)

    final_app = (root / "app.js").read_text(encoding="utf-8")
    final_index = index.read_text(encoding="utf-8")
    if "CONUTWAY QUOTATION COST ENGINE V3" not in final_app:
        raise RuntimeError("Motor de custos V3 não foi injetado no app.js.")
    if 'data-conutway-cost-engine="v3"' not in final_index:
        raise RuntimeError("CSS do motor de custos V3 não foi injetado no index.html.")
    if not (final_index.find(ITEMS_ORDER_MARKER) < final_index.find('id="projectPricingPanel"')):
        raise RuntimeError("Itens da cotação voltaram para depois dos custos no build final.")

    print(
        "QUOTATION_LAYOUT_OK",
        f"css_bytes={target.stat().st_size}",
        f"alignment_css_bytes={alignment_target.stat().st_size}",
        "version=v2",
        "alignment=v3",
        "cost_engine=v3",
        "pricing_order=exchange-items-costs",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import re
import shutil
import sys

MARKER = "CONUTWAY QUOTATION LAYOUT V2"
LINK_MARKER = 'data-conutway-quotation-layout="v2"'


def inject_link(html: str) -> str:
    link = '<link rel="stylesheet" href="assets/quotation-layout-v2.css" data-conutway-quotation-layout="v2">'
    if LINK_MARKER in html:
        return html
    if "</head>" not in html.lower():
        raise RuntimeError("Fechamento </head> não encontrado para injetar layout de Cotações.")
    return re.sub(r"</head>", f"  {link}\n</head>", html, count=1, flags=re.IGNORECASE)


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "_site").resolve()
    source = repo_root / ".github" / "pages" / "quotation-layout-v2.css"
    index = root / "index.html"
    fallback = root / "404.html"
    assets = root / "assets"

    for required in (source, index, fallback):
        if not required.is_file() or required.stat().st_size == 0:
            raise FileNotFoundError(f"Arquivo obrigatório do layout de Cotações não encontrado: {required}")

    css = source.read_text(encoding="utf-8")
    if MARKER not in css:
        raise RuntimeError("CSS de Cotações não possui o marcador esperado.")

    assets.mkdir(parents=True, exist_ok=True)
    target = assets / "quotation-layout-v2.css"
    shutil.copy2(source, target)

    for path in (index, fallback):
        html = path.read_text(encoding="utf-8")
        html = inject_link(html)
        path.write_text(html, encoding="utf-8")

    final_index = index.read_text(encoding="utf-8")
    final_css = target.read_text(encoding="utf-8")
    checks = {
        "link": LINK_MARKER in final_index,
        "css": MARKER in final_css,
        "pricing": "#projects .estimated-cost-profile-bar" in final_css,
        "items": "#projects .quotation-items-editor" in final_css,
        "summary": "#projects #projectPricingSummary" in final_css,
    }
    failed = [name for name, ok in checks.items() if not ok]
    if failed:
        raise RuntimeError("Falha na validação do layout de Cotações: " + ", ".join(failed))

    print("QUOTATION_LAYOUT_OK", f"css_bytes={target.stat().st_size}", "version=v2")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

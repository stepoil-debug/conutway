#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import re
import shutil
import sys

THEME_MARKER = "CONUTWAY WORKSPACE PREMIUM V1"
THEME_ATTR = 'data-workspace-theme="premium-v1"'
EXPECTED_MODULE_TARGETS = 14


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "_site").resolve()

    index_path = root / "index.html"
    style_path = root / "styles.css"
    theme_path = repo_root / ".github" / "pages" / "workspace-premium.css"
    logo_path = repo_root / ".github" / "pages" / "conutway-teza-logo-v2.svg"

    for required in (index_path, style_path, theme_path, logo_path):
        if not required.is_file() or required.stat().st_size == 0:
            raise FileNotFoundError(f"Arquivo obrigatório do tema não encontrado: {required}")

    html = index_path.read_text(encoding="utf-8")
    module_count_before = html.count("data-module-target=")
    if module_count_before != EXPECTED_MODULE_TARGETS:
        raise RuntimeError(
            f"Quantidade inesperada de módulos antes do tema: {module_count_before} "
            f"(esperado {EXPECTED_MODULE_TARGETS})."
        )

    assets_dir = root / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(logo_path, assets_dir / "conutway-teza-logo-v2.svg")

    brand_pattern = re.compile(
        r'(<div\s+class=["\']brand-block["\'][^>]*>\s*<img\s+)([^>]*)(/?>)',
        flags=re.IGNORECASE,
    )
    match = brand_pattern.search(html)
    if not match:
        raise RuntimeError("Bloco da marca lateral não encontrado; nenhuma estrutura foi alterada.")

    attrs = match.group(2)
    if re.search(r'\bsrc=["\'][^"\']*["\']', attrs, flags=re.IGNORECASE):
        attrs = re.sub(
            r'\bsrc=["\'][^"\']*["\']',
            'src="assets/conutway-teza-logo-v2.svg"',
            attrs,
            count=1,
            flags=re.IGNORECASE,
        )
    else:
        attrs = 'src="assets/conutway-teza-logo-v2.svg" ' + attrs

    html = html[: match.start()] + match.group(1) + attrs + match.group(3) + html[match.end() :]

    if THEME_ATTR not in html:
        html = re.sub(
            r'<body(\s[^>]*)?>',
            lambda m: '<body' + (m.group(1) or '') + f' {THEME_ATTR}>',
            html,
            count=1,
            flags=re.IGNORECASE,
        )

    module_count_after = html.count("data-module-target=")
    if module_count_after != module_count_before:
        raise RuntimeError(
            f"Proteção de integridade acionada: módulos antes={module_count_before}, depois={module_count_after}."
        )

    index_path.write_text(html, encoding="utf-8")

    css = style_path.read_text(encoding="utf-8")
    premium_css = theme_path.read_text(encoding="utf-8")
    if THEME_MARKER not in css:
        style_path.write_text(css.rstrip() + "\n\n" + premium_css.strip() + "\n", encoding="utf-8")

    final_html = index_path.read_text(encoding="utf-8")
    final_css = style_path.read_text(encoding="utf-8")
    checks = {
        "logo": "assets/conutway-teza-logo-v2.svg" in final_html,
        "theme-attr": THEME_ATTR in final_html,
        "theme-css": THEME_MARKER in final_css,
        "modules": final_html.count("data-module-target=") == EXPECTED_MODULE_TARGETS,
    }
    failed = [name for name, ok in checks.items() if not ok]
    if failed:
        raise RuntimeError("Falha na validação final do tema: " + ", ".join(failed))

    print(
        "WORKSPACE_PREMIUM_OK",
        f"modules={EXPECTED_MODULE_TARGETS}",
        f"css_bytes={style_path.stat().st_size}",
        f"logo_bytes={(assets_dir / 'conutway-teza-logo-v2.svg').stat().st_size}",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

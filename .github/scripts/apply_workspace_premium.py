#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import re
import shutil
import sys

THEME_MARKER = "CONUTWAY WORKSPACE PREMIUM V1"
LOGO_MARKER = "CONUTWAY LOGO TRANSPARENT OVERRIDES"
LOGIN_LOGO_MARKER = "CONUTWAY LOGIN LOGO CONTRAST V1"
SIDEBAR_MARKER = "CONUTWAY SIDEBAR COLLAPSIBLE PREMIUM V1"
THEME_ATTR = 'data-workspace-theme="premium-v1"'
EXPECTED_MODULE_TARGETS = 14


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "_site").resolve()

    index_path = root / "index.html"
    login_path = root / "login.html"
    style_path = root / "styles.css"
    theme_path = repo_root / ".github" / "pages" / "workspace-premium.css"
    logo_override_path = repo_root / ".github" / "pages" / "workspace-logo-transparent.css"
    sidebar_css_path = repo_root / ".github" / "pages" / "workspace-sidebar-collapse.css"
    sidebar_js_path = repo_root / ".github" / "pages" / "workspace-sidebar-collapse.js"
    logo_path = repo_root / ".github" / "pages" / "conutway-teza-logo-v2.svg"
    emblem_path = repo_root / ".github" / "pages" / "conutway-teza-emblem.svg"

    for required in (
        index_path, login_path, style_path, theme_path, logo_override_path,
        sidebar_css_path, sidebar_js_path, logo_path, emblem_path,
    ):
        if not required.is_file() or required.stat().st_size == 0:
            raise FileNotFoundError(f"Arquivo obrigatório do tema não encontrado: {required}")

    logo_source = logo_path.read_text(encoding="utf-8")
    if '<rect width="310" height="112"' in logo_source or 'fill="#eeeade"' in logo_source:
        raise RuntimeError("A logo ainda contém o antigo fundo bege/branco.")

    emblem_source = emblem_path.read_text(encoding="utf-8")
    if '<svg' not in emblem_source or 'aria-label="GT"' not in emblem_source:
        raise RuntimeError("O emblema GT não é um SVG válido.")

    sidebar_css_source = sidebar_css_path.read_text(encoding="utf-8")
    sidebar_js_source = sidebar_js_path.read_text(encoding="utf-8")
    if SIDEBAR_MARKER not in sidebar_css_source or SIDEBAR_MARKER not in sidebar_js_source:
        raise RuntimeError("Assets do menu recolhível não possuem o marcador esperado.")

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
    shutil.copy2(emblem_path, assets_dir / "conutway-teza-emblem.svg")
    shutil.copy2(sidebar_css_path, assets_dir / "workspace-sidebar-collapse.css")
    shutil.copy2(sidebar_js_path, assets_dir / "workspace-sidebar-collapse.js")

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

    if re.search(r'\bclass=["\'][^"\']*["\']', attrs, flags=re.IGNORECASE):
        attrs = re.sub(
            r'\bclass=["\'][^"\']*["\']',
            'class="brand-logo-full"',
            attrs,
            count=1,
            flags=re.IGNORECASE,
        )
    else:
        attrs = 'class="brand-logo-full" ' + attrs

    full_logo = match.group(1) + attrs + match.group(3)
    emblem_logo = '<img class="brand-logo-emblem" src="assets/conutway-teza-emblem.svg" alt="GT" aria-hidden="true">'
    html = html[: match.start()] + full_logo + emblem_logo + html[match.end() :]

    if THEME_ATTR not in html:
        html = re.sub(
            r'<body(\s[^>]*)?>',
            lambda m: '<body' + (m.group(1) or '') + f' {THEME_ATTR}>',
            html,
            count=1,
            flags=re.IGNORECASE,
        )

    sidebar_link = '<link rel="stylesheet" href="assets/workspace-sidebar-collapse.css" data-conutway-sidebar="premium-v1">'
    if 'workspace-sidebar-collapse.css' not in html:
        html = re.sub(
            r'</head>',
            '  ' + sidebar_link + '\n</head>',
            html,
            count=1,
            flags=re.IGNORECASE,
        )

    sidebar_script = '<script defer src="assets/workspace-sidebar-collapse.js" data-conutway-sidebar="premium-v1"></script>'
    if 'workspace-sidebar-collapse.js' not in html:
        html = re.sub(
            r'</body>',
            '  ' + sidebar_script + '\n</body>',
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
    logo_css = logo_override_path.read_text(encoding="utf-8")
    if THEME_MARKER not in css:
        css = css.rstrip() + "\n\n" + premium_css.strip() + "\n"
    if LOGO_MARKER not in css:
        css = css.rstrip() + "\n\n" + logo_css.strip() + "\n"
    style_path.write_text(css, encoding="utf-8")

    login = login_path.read_text(encoding="utf-8")
    if 'class="brand-logo-shell"' not in login:
        login_logo_pattern = re.compile(
            r'(<img\s+class=["\']brand-logo["\'][^>]*>)',
            flags=re.IGNORECASE,
        )
        login_match = login_logo_pattern.search(login)
        if not login_match:
            raise RuntimeError("Logo principal do login não encontrada para correção de contraste.")
        wrapped_logo = '<div class="brand-logo-shell">' + login_match.group(1) + '</div>'
        login = login[: login_match.start()] + wrapped_logo + login[login_match.end() :]

    if LOGIN_LOGO_MARKER not in login:
        login_logo_css = f"""
<style id="conutwayLoginLogoContrast">
/* {LOGIN_LOGO_MARKER} */
.brand-logo-shell{{
  width:310px;
  max-width:56vw;
  display:flex;
  align-items:center;
  justify-content:center;
  padding:13px 17px;
  border:1px solid rgba(255,255,255,.18);
  border-radius:18px;
  background:linear-gradient(135deg,rgba(3,17,31,.78),rgba(5,27,44,.52));
  box-shadow:0 18px 48px rgba(0,0,0,.34),inset 0 1px 0 rgba(255,255,255,.08);
  backdrop-filter:blur(14px) saturate(125%);
  -webkit-backdrop-filter:blur(14px) saturate(125%);
}}
.brand-logo-shell .brand-logo{{
  display:block;
  width:100%;
  max-width:none;
  height:auto;
  border-radius:0;
  background:transparent;
  box-shadow:none;
  filter:brightness(0) invert(1) drop-shadow(0 7px 18px rgba(0,0,0,.25));
  opacity:.98;
}}
@media(max-width:1180px){{.brand-logo-shell{{width:270px}}}}
@media(max-width:900px){{.brand-logo-shell{{width:260px;max-width:72vw}}}}
@media(max-width:560px){{.brand-logo-shell{{width:220px;padding:11px 14px;border-radius:15px}}}}
</style>
"""
        login = re.sub(
            r'</head>',
            login_logo_css + '\n</head>',
            login,
            count=1,
            flags=re.IGNORECASE,
        )
    login_path.write_text(login, encoding="utf-8")

    final_html = index_path.read_text(encoding="utf-8")
    final_css = style_path.read_text(encoding="utf-8")
    final_login = login_path.read_text(encoding="utf-8")
    checks = {
        "logo": "assets/conutway-teza-logo-v2.svg" in final_html,
        "emblem": "assets/conutway-teza-emblem.svg" in final_html,
        "logo-full-class": 'class="brand-logo-full"' in final_html,
        "logo-emblem-class": 'class="brand-logo-emblem"' in final_html,
        "theme-attr": THEME_ATTR in final_html,
        "theme-css": THEME_MARKER in final_css,
        "logo-transparent-css": LOGO_MARKER in final_css,
        "login-logo-contrast": LOGIN_LOGO_MARKER in final_login,
        "login-logo-shell": 'class="brand-logo-shell"' in final_login,
        "sidebar-css": "assets/workspace-sidebar-collapse.css" in final_html,
        "sidebar-js": "assets/workspace-sidebar-collapse.js" in final_html,
        "sidebar-assets": (assets_dir / "workspace-sidebar-collapse.css").is_file() and (assets_dir / "workspace-sidebar-collapse.js").is_file(),
        "emblem-asset": (assets_dir / "conutway-teza-emblem.svg").is_file(),
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
        f"emblem_bytes={(assets_dir / 'conutway-teza-emblem.svg').stat().st_size}",
        "logo_transparent=1",
        "login_logo_contrast=1",
        "sidebar_collapsible=1",
        "sidebar_emblem_only=1",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

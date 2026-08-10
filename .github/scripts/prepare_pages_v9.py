#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import shutil
import subprocess
import sys


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    template = repo_root / ".github" / "pages" / "login-template.html"
    legacy_prepare = repo_root / ".github" / "scripts" / "prepare_pages.py"
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "_site")

    text = template.read_text(encoding="utf-8")
    auth_marker = "sessionStorage.setItem('conutway.auth.v1'"
    current_success = (
        "sessionStorage.setItem(KEY,JSON.stringify({username:'admin',role:'admin',issuedAt:now,"
        "expiresAt:now+12*60*60*1000}));location.replace(DEST)"
    )
    aligned_success = (
        "sessionStorage.setItem(KEY,JSON.stringify({username:'admin',role:'admin',issuedAt:now,"
        "expiresAt:now+12*60*60*1000}));"
        "sessionStorage.setItem('conutway.auth.v1',JSON.stringify({user:'admin',issuedAt:now}));"
        "location.replace(DEST)"
    )
    if auth_marker not in text:
        if current_success not in text:
            raise RuntimeError("Trecho de sucesso do login não encontrado para alinhar a autenticação.")
        template.write_text(text.replace(current_success, aligned_success, 1), encoding="utf-8")

    args = [sys.executable, str(legacy_prepare), *sys.argv[1:]]
    subprocess.run(args, check=True)

    assets = root / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    hero_src = repo_root / ".github" / "pages" / "conutway-brazil-china-hero-user.webp"
    logo_src = repo_root / ".github" / "pages" / "conutway-teza-logo-user.webp"
    if not hero_src.is_file() or not logo_src.is_file():
        raise FileNotFoundError("Hero/logo binários do login não encontrados no repositório.")
    shutil.copy2(hero_src, assets / "conutway-brazil-china-hero-user.webp")
    shutil.copy2(logo_src, assets / "conutway-teza-logo-user.webp")

    login_path = root / "login.html"
    login = login_path.read_text(encoding="utf-8")

    hero_candidates = [
        'assets/conutway-brazil-china-hero.webp',
        'assets/conutway-hero-user-v9.webp',
    ]
    if 'assets/conutway-brazil-china-hero-user.webp' not in login:
        for candidate in hero_candidates:
            if candidate in login:
                login = login.replace(candidate, 'assets/conutway-brazil-china-hero-user.webp', 1)
                break
        else:
            raise RuntimeError("Imagem hero atual não encontrada no login gerado.")

    logo_candidates = [
        'assets/conutway-teza-logo-v2.svg',
        'assets/conutway-teza-logo-crop.svg',
    ]
    if 'assets/conutway-teza-logo-user.webp' not in login:
        for candidate in logo_candidates:
            if candidate in login:
                login = login.replace(candidate, 'assets/conutway-teza-logo-user.webp', 1)
                break
        else:
            raise RuntimeError("Imagem de logo atual não encontrada no login gerado.")

    for marker in ('target-v2-backup-hero', 'premium-user-hero-v9'):
        login = login.replace(marker, 'premium-user-assets-v15')

    # Corrige a pilha visual: antes o hero ficava atrás do background do próprio painel.
    login = login.replace('z-index:-5;', 'z-index:0;', 1)
    login = login.replace('z-index:-4;', 'z-index:1;', 1)
    login = login.replace('z-index:-3;', 'z-index:2;', 1)
    login = login.replace('.hero-inner{min-height:', '.hero-inner{position:relative;z-index:3;min-height:', 1)

    # Preserva a imagem inteira China/Brasil sem cortar as laterais.
    login = login.replace(
        'width:100%;height:72%;object-fit:cover;object-position:center center;',
        'width:100%;height:auto;object-fit:contain;object-position:center top;',
        1,
    )

    login_path.write_text(login, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

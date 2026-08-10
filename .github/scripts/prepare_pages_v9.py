#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import subprocess
import sys


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    template = repo_root / ".github" / "pages" / "login-template.html"
    legacy_prepare = repo_root / ".github" / "scripts" / "prepare_pages.py"

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
            raise RuntimeError("Trecho de sucesso do login v9 não encontrado para alinhar a autenticação.")
        template.write_text(text.replace(current_success, aligned_success, 1), encoding="utf-8")

    args = [sys.executable, str(legacy_prepare), *sys.argv[1:]]
    subprocess.run(args, check=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

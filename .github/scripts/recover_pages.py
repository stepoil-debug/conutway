#!/usr/bin/env python3
from __future__ import annotations

import base64
import binascii
import io
import lzma
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import zipfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BUNDLE_REF = "origin/fix/pages-bundle-integrity"
REQUIRED = ("index.html", "app.js", "styles.css", "storage.js", "permissions.js")


def run(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=ROOT, check=check, text=True, capture_output=True)


def clean_base64(text: str) -> str:
    return "".join(text.split())


def recover_tar_frontend(destination: Path) -> None:
    # Usa apenas os segmentos numéricos originais. Arquivos auxiliares/probes
    # existentes no diretório não fazem parte do fluxo base64.
    parts = sorted(
        (p for p in (ROOT / ".bootstrap").glob("part-*") if re.fullmatch(r"part-\d+", p.name)),
        key=lambda p: p.name,
    )
    if not parts:
        raise RuntimeError("Nenhuma parte .bootstrap encontrada.")

    chunks: list[str] = []
    for part in parts:
        value = clean_base64(part.read_text(encoding="utf-8"))
        if value == "PLACEHOLDER":
            continue
        chunks.append(value)

    encoded = "".join(chunks)
    encoded += "=" * ((-len(encoded)) % 4)
    raw = base64.b64decode(encoded, validate=True)
    if not raw.startswith(b"\xfd7zXZ\x00"):
        raise RuntimeError("Bootstrap recuperado não possui cabeçalho XZ válido.")

    decoder = lzma.LZMADecompressor(format=lzma.FORMAT_XZ)
    tar_bytes = decoder.decompress(raw)
    if len(tar_bytes) < 100_000:
        raise RuntimeError(f"TAR recuperado pequeno demais: {len(tar_bytes)} bytes")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        tar_path = tmp_path / "recovered.tar"
        extract_path = tmp_path / "extract"
        extract_path.mkdir()
        tar_path.write_bytes(tar_bytes)
        subprocess.run(
            ["tar", "-xf", str(tar_path), "-C", str(extract_path), "--ignore-zeros", "--warning=no-unknown-keyword"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        app = extract_path / "app"
        if not app.is_dir():
            raise RuntimeError("Diretório app/ não pôde ser recuperado do bootstrap.")
        shutil.copytree(app, destination, dirs_exist_ok=True)

    print(f"bootstrap_parts={len(parts)} bootstrap_tar_bytes={len(tar_bytes)} xz_eof={decoder.eof}")


def bundle_part_names() -> list[str]:
    result = run("git", "ls-tree", "-r", "--name-only", BUNDLE_REF, ".pages-bundle")
    names = [line.strip() for line in result.stdout.splitlines() if re.fullmatch(r"\.pages-bundle/part-\d+", line.strip())]
    return sorted(names, key=lambda p: int(p.rsplit("-", 1)[1]))


def recover_zip_members(destination: Path) -> None:
    names = bundle_part_names()
    if not names:
        raise RuntimeError(f"Nenhum segmento disponível em {BUNDLE_REF}.")

    chunks: list[str] = []
    for name in names:
        chunks.append(clean_base64(run("git", "show", f"{BUNDLE_REF}:{name}").stdout))

    suffix_path = ROOT / "conutway-pages-ready.b64"
    if not suffix_path.is_file():
        raise RuntimeError("conutway-pages-ready.b64 não encontrado.")
    chunks.append(clean_base64(suffix_path.read_text(encoding="utf-8")))

    encoded = "".join(chunks)
    encoded += "=" * ((-len(encoded)) % 4)
    raw = base64.b64decode(encoded, validate=True)
    archive = zipfile.ZipFile(io.BytesIO(raw))
    infos = {item.filename: item for item in archive.infolist()}

    local_headers: dict[str, int] = {}
    cursor = 0
    while True:
        offset = raw.find(b"PK\x03\x04", cursor)
        if offset < 0 or offset + 30 > len(raw):
            break
        try:
            _, _, flag, _, _, _, _, _, _, name_len, extra_len = struct.unpack_from("<4s5H3L2H", raw, offset)
            name_bytes = raw[offset + 30 : offset + 30 + name_len]
            name = name_bytes.decode("utf-8" if flag & 0x800 else "cp437")
            if name in infos:
                local_headers[name] = offset
        except Exception:
            pass
        cursor = offset + 4

    recovered = 0
    failed: list[str] = []
    for name, info in infos.items():
        offset = local_headers.get(name)
        if offset is None:
            failed.append(f"{name}:header_missing")
            continue
        _, _, _, _, _, _, _, _, _, name_len, extra_len = struct.unpack_from("<4s5H3L2H", raw, offset)
        data_start = offset + 30 + name_len + extra_len
        compressed = raw[data_start : data_start + info.compress_size]
        if len(compressed) != info.compress_size:
            failed.append(f"{name}:compressed_truncated")
            continue
        try:
            if info.compress_type == zipfile.ZIP_STORED:
                data = compressed
            elif info.compress_type == zipfile.ZIP_DEFLATED:
                data = zlib.decompress(compressed, -15)
            else:
                failed.append(f"{name}:unsupported_method_{info.compress_type}")
                continue
        except Exception as exc:
            failed.append(f"{name}:decompress_{type(exc).__name__}")
            continue

        crc = binascii.crc32(data) & 0xFFFFFFFF
        if len(data) != info.file_size or crc != info.CRC:
            failed.append(f"{name}:validation_failed")
            continue

        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        recovered += 1

    print(f"zip_members={len(infos)} zip_recovered={recovered} zip_failed={','.join(failed) or 'none'}")


def remove_backend_only(destination: Path) -> None:
    for name in (
        "server.js",
        "rfq-server-service.js",
        "workspace-rfq-client.js",
        "docker-compose.yml",
        "start-conutway-br-erp.sh",
        "README.md",
    ):
        (destination / name).unlink(missing_ok=True)

    for name in ("tools", "node_modules", "data", "secure", "uploads", "exports", "backup", "deployment"):
        shutil.rmtree(destination / name, ignore_errors=True)


def validate(destination: Path) -> None:
    missing = [name for name in REQUIRED if not (destination / name).is_file() or (destination / name).stat().st_size == 0]
    if missing:
        raise RuntimeError(f"Arquivos obrigatórios ausentes: {', '.join(missing)}")

    subprocess.run(["node", "--check", str(destination / "app.js")], check=True)
    subprocess.run(["node", "--check", str(destination / "storage.js")], check=True)
    subprocess.run(["node", "--check", str(destination / "permissions.js")], check=True)


def main() -> int:
    destination = Path(sys.argv[1] if len(sys.argv) > 1 else "_site").resolve()
    shutil.rmtree(destination, ignore_errors=True)
    destination.mkdir(parents=True, exist_ok=True)

    recover_tar_frontend(destination)
    recover_zip_members(destination)
    remove_backend_only(destination)
    (destination / ".nojekyll").touch()
    validate(destination)

    files = [path for path in destination.rglob("*") if path.is_file()]
    print(f"RECOVERY_OK files={len(files)}")
    for name in REQUIRED:
        path = destination / name
        print(f"{name}={path.stat().st_size}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

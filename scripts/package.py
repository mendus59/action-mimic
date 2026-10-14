"""Build the Chrome Web Store upload zip: python scripts/package.py

Validates the manifest against Web Store limits, checks that every file the
manifest references exists, and writes dist/action-mimic-<version>.zip
containing only the runtime files (manifest.json, icons/, src/).
"""
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INCLUDE = ["manifest.json", "icons", "src"]
SKIP_SUFFIXES = {".map", ".md", ".ts"}
SKIP_NAMES = {".DS_Store", "Thumbs.db", "desktop.ini"}

errors = []


def fail(msg):
    errors.append(msg)


manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
version = manifest.get("version", "")

# --- Web Store limits -------------------------------------------------------
if manifest.get("manifest_version") != 3:
    fail("manifest_version must be 3")
if not re.fullmatch(r"\d+(\.\d+){0,3}", version) or any(int(p) > 65535 for p in version.split(".")):
    fail(f"version '{version}' must be 1-4 dot-separated integers (0-65535)")
if len(manifest.get("name", "")) > 75:
    fail("name must be 75 characters or fewer")
if not 0 < len(manifest.get("description", "")) <= 132:
    fail("description is required and must be 132 characters or fewer")
if "128" not in manifest.get("icons", {}):
    fail("a 128x128 icon is required")

# --- Referenced files exist ---------------------------------------------------
refs = list(manifest.get("icons", {}).values())
refs += list(manifest.get("action", {}).get("default_icon", {}).values())
refs += [manifest.get("action", {}).get("default_popup")]
refs += [manifest.get("background", {}).get("service_worker")]
refs += [manifest.get("options_ui", {}).get("page")]
for cs in manifest.get("content_scripts", []):
    refs += cs.get("js", []) + cs.get("css", [])
for ref in filter(None, refs):
    if not (ROOT / ref).is_file():
        fail(f"manifest references missing file: {ref}")

# Relative src/href references inside extension HTML pages.
for html in (ROOT / "src").rglob("*.html"):
    for ref in re.findall(r'(?:src|href)="([^"#:]+)"', html.read_text(encoding="utf-8")):
        if not (html.parent / ref).resolve().is_file():
            fail(f"{html.relative_to(ROOT)} references missing file: {ref}")

if errors:
    print("Package NOT built:")
    for e in errors:
        print("  -", e)
    sys.exit(1)

# --- Zip ---------------------------------------------------------------------
files = []
for entry in INCLUDE:
    p = ROOT / entry
    candidates = [p] if p.is_file() else sorted(x for x in p.rglob("*") if x.is_file())
    for f in candidates:
        if f.name in SKIP_NAMES or f.suffix in SKIP_SUFFIXES or f.name.startswith("."):
            continue
        files.append(f)

out_dir = ROOT / "dist"
out_dir.mkdir(exist_ok=True)
out = out_dir / f"action-mimic-{version}.zip"
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for f in files:
        # Forward slashes are required; the Web Store rejects backslash paths.
        z.write(f, f.relative_to(ROOT).as_posix())

print(f"Built {out.relative_to(ROOT)} ({len(files)} files, {out.stat().st_size / 1024:.1f} KB)")
for f in files:
    print("  ", f.relative_to(ROOT).as_posix())

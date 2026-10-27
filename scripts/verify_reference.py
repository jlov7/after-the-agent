"""Check a frozen manifest without regenerating or modifying reference evidence.

A local manifest detects inconsistency, not independent provenance. Supply a
manifest digest from outside the candidate changes for an external byte anchor.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
from typing import Any


PACK_ROOT = Path(__file__).resolve().parents[1]
MAX_JSON_BYTES = 8 * 1024 * 1024
SHA256 = re.compile(r"[a-f0-9]{64}", re.ASCII)


class VerificationError(ValueError):
    """A required input is invalid, absent, changed, or outside the pack."""


class FailClosedParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise VerificationError(message)


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result = {}
    for key, value in pairs:
        if key in result:
            raise VerificationError("duplicate JSON object key")
        result[key] = value
    return result


def _reject_constant(value: str) -> Any:
    raise VerificationError("nonfinite JSON number is forbidden")


def read_bounded_bytes(path: Path) -> bytes:
    try:
        if not path.is_file():
            raise VerificationError(f"not a regular file: {path}")
        with path.open("rb") as source:
            raw = source.read(MAX_JSON_BYTES + 1)
        if len(raw) > MAX_JSON_BYTES:
            raise VerificationError("JSON input exceeds 8 MiB limit")
        return raw
    except OSError as error:
        raise VerificationError(f"cannot read input: {error}") from error


def parse_json(raw: bytes) -> Any:
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_object,
                          parse_constant=_reject_constant)
    except VerificationError:
        raise
    except (UnicodeError, ValueError, RecursionError) as error:
        raise VerificationError(f"invalid JSON input: {error}") from error


def load_json(path: Path) -> Any:
    return parse_json(read_bounded_bytes(path))


def safe_file(root: Path, relative: Any) -> Path:
    """Accept canonical portable relative paths resolving to files in root."""
    if (type(relative) is not str or not relative or len(relative) > 512
            or "\\" in relative or ":" in relative
            or any(ord(char) < 32 or ord(char) == 127 for char in relative)
            or any(part in ("", ".", "..") for part in relative.split("/"))):
        raise VerificationError("invalid canonical relative file path")
    try:
        root = root.resolve(strict=True)
        if not root.is_dir():
            raise VerificationError("pack root is not a directory")
        target = (root / relative).resolve(strict=True)
        if not target.is_relative_to(root):
            raise VerificationError(f"reference resolves outside pack root: {relative}")
        if not target.is_file():
            raise VerificationError(f"reference is not a regular file: {relative}")
        return target
    except (OSError, RuntimeError) as error:
        raise VerificationError(f"cannot resolve required file {relative}: {error}") from error


def _valid_digest(value: Any, where: str) -> None:
    if type(value) is not str or SHA256.fullmatch(value) is None:
        raise VerificationError(f"{where}: expected lowercase SHA-256 digest")


def file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as source:
            for block in iter(lambda: source.read(65536), b""):
                digest.update(block)
    except OSError as error:
        raise VerificationError(f"cannot hash reference file: {error}") from error
    return digest.hexdigest()


def verify_reference(root: Path = PACK_ROOT, manifest_path: Path | None = None,
                     expected_manifest_sha: str | None = None) -> dict[str, Any]:
    root = Path(root)
    manifest_path = Path(manifest_path) if manifest_path is not None else root / "REFERENCE_MANIFEST.json"
    raw = read_bounded_bytes(manifest_path)
    manifest_sha = hashlib.sha256(raw).hexdigest()
    if expected_manifest_sha is not None:
        _valid_digest(expected_manifest_sha, "expected manifest anchor")
        if manifest_sha != expected_manifest_sha:
            raise VerificationError("manifest digest mismatch against supplied external anchor")
    manifest = parse_json(raw)
    if (type(manifest) is not dict
            or manifest.keys() != {"schema_version", "reference_version", "files"}
            or manifest["schema_version"] != "1.0"
            or manifest["reference_version"] != "1.0.0"):
        raise VerificationError("unsupported or malformed reference manifest")
    entries = manifest["files"]
    if type(entries) is not list or not 1 <= len(entries) <= 1024:
        raise VerificationError("manifest files must be a nonempty bounded array")
    seen = set()
    for entry in entries:
        if type(entry) is not dict or entry.keys() != {"path", "sha256"}:
            raise VerificationError("manifest entry must contain exactly path and sha256")
        target = safe_file(root, entry["path"])
        if entry["path"] in seen:
            raise VerificationError("duplicate reference path")
        seen.add(entry["path"])
        _valid_digest(entry["sha256"], "reference entry")
        if file_digest(target) != entry["sha256"]:
            raise VerificationError(f"reference digest mismatch: {entry['path']}")
    return {
        "passed": True, "schema_version": "1.0", "reference_version": "1.0.0",
        "files_checked": len(entries), "manifest_sha256": manifest_sha,
        "external_anchor_checked": expected_manifest_sha is not None,
    }


def main(argv: list[str] | None = None) -> int:
    parser = FailClosedParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=PACK_ROOT)
    parser.add_argument("--manifest", type=Path, default=None)
    parser.add_argument("--expected-manifest-sha", default=None)
    try:
        args = parser.parse_args(argv)
        result = verify_reference(args.root, args.manifest, args.expected_manifest_sha)
    except VerificationError as error:
        print(f"Reference verification FAILED: {error}", file=sys.stderr)
        return 1
    anchor = "supplied anchor checked" if result["external_anchor_checked"] else "local manifest only"
    print(f"Reference verification passed: {result['files_checked']} files; {anchor}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable

TARGET_API = 36
MIN_AGP = (8, 9, 1)
SAFE_AGP = "8.10.2"
MIN_GRADLE = (8, 11, 1)
SAFE_GRADLE = "8.11.1"

SKIP_DIRS = {".git", ".gradle", "build", ".idea", "node_modules", ".cxx", ".kotlin"}
SOURCE_SUFFIXES = {".kt", ".java"}


@dataclass
class Finding:
    code: str
    severity: str
    path: str
    message: str
    fixed: bool = False


@dataclass
class Report:
    root: str
    changed_files: list[str]
    findings: list[Finding]
    build: dict

    def to_json(self) -> str:
        payload = {
            "root": self.root,
            "changed_files": self.changed_files,
            "findings": [asdict(x) for x in self.findings],
            "build": self.build,
        }
        return json.dumps(payload, indent=2, ensure_ascii=False)


def _walk(root: Path, patterns: Iterable[str] | None = None) -> Iterable[Path]:
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        if patterns is None or p.name in patterns:
            yield p


def _version_tuple(value: str) -> tuple[int, ...]:
    nums = re.findall(r"\d+", value)
    return tuple(int(n) for n in nums[:3]) if nums else (0,)


def _replace_file(path: Path, transform) -> bool:
    original = path.read_text(encoding="utf-8", errors="ignore")
    updated = transform(original)
    if updated != original:
        path.write_text(updated, encoding="utf-8")
        return True
    return False


def _rel(root: Path, path: Path) -> str:
    try:
        return str(path.relative_to(root))
    except ValueError:
        return str(path)


def _gradle_files(root: Path) -> list[Path]:
    return list(_walk(root, {"build.gradle", "build.gradle.kts"}))


def _patch_sdk_text(text: str) -> tuple[str, bool, bool]:
    changed = False
    saw = False

    patterns = [
        (r"(\bcompileSdk(?:Version)?\s*(?:=\s*)?)(\d+)(\b)", "compile"),
        (r"(\btargetSdk(?:Version)?\s*(?:=\s*)?)(\d+)(\b)", "target"),
    ]
    for pattern, _ in patterns:
        def repl(m):
            nonlocal changed, saw
            saw = True
            if int(m.group(2)) != TARGET_API:
                changed = True
            return f"{m.group(1)}{TARGET_API}{m.group(3)}"
        text = re.sub(pattern, repl, text)
    return text, changed, saw


def _patch_version_catalog(path: Path) -> bool:
    def transform(text: str) -> str:
        text = re.sub(r'(?m)^(\s*(?:compileSdk|compile-sdk|androidCompileSdk)\s*=\s*")[^"]+("\s*)$', rf'\g<1>{TARGET_API}\g<2>', text)
        text = re.sub(r'(?m)^(\s*(?:targetSdk|target-sdk|androidTargetSdk)\s*=\s*")[^"]+("\s*)$', rf'\g<1>{TARGET_API}\g<2>', text)
        text = re.sub(r'(?m)^(\s*agp\s*=\s*")([0-9][^"]*)("\s*)$', lambda m: f'{m.group(1)}{SAFE_AGP}{m.group(3)}' if _version_tuple(m.group(2)) < MIN_AGP else m.group(0), text)
        return text
    return _replace_file(path, transform)


def _patch_agp(path: Path) -> tuple[bool, bool]:
    original = path.read_text(encoding="utf-8", errors="ignore")
    found_old = False

    def upgrade_version(m):
        nonlocal found_old
        v = m.group("v")
        if _version_tuple(v) < MIN_AGP:
            found_old = True
            return m.group(0).replace(v, SAFE_AGP)
        return m.group(0)

    patterns = [
        r'(?P<prefix>com\.android\.(?:application|library)["\']?\)?\s+version\s+["\'])(?P<v>\d+(?:\.\d+){1,3})(?P<suffix>["\'])',
        r'(?P<prefix>com\.android\.tools\.build:gradle:)(?P<v>\d+(?:\.\d+){1,3})',
    ]
    updated = original
    for pat in patterns:
        updated = re.sub(pat, upgrade_version, updated)
    if updated != original:
        path.write_text(updated, encoding="utf-8")
        return True, found_old
    return False, found_old


def _patch_wrapper(path: Path) -> bool:
    def transform(text: str) -> str:
        def repl(m):
            v = m.group(1)
            if _version_tuple(v) < MIN_GRADLE:
                return m.group(0).replace(v, SAFE_GRADLE)
            return m.group(0)
        return re.sub(r"gradle-(\d+(?:\.\d+){1,3})-(?:bin|all)\.zip", repl, text)
    return _replace_file(path, transform)


def _detect_legacy_back(root: Path) -> list[Path]:
    hits: list[Path] = []
    for p in _walk(root):
        if p.suffix not in SOURCE_SUFFIXES:
            continue
        text = p.read_text(encoding="utf-8", errors="ignore")
        if "onBackPressed(" in text or "KEYCODE_BACK" in text:
            if "OnBackPressedDispatcher" not in text and "OnBackInvokedDispatcher" not in text:
                hits.append(p)
    return hits


def _detect_nonsdk(root: Path) -> list[Path]:
    hits: list[Path] = []
    risky = [r'Class\.forName\(["\']android\.', r'getDeclared(?:Method|Field)\(']
    for p in _walk(root):
        if p.suffix not in SOURCE_SUFFIXES:
            continue
        text = p.read_text(encoding="utf-8", errors="ignore")
        if any(re.search(x, text) for x in risky):
            hits.append(p)
    return hits


def _manifest_files(root: Path) -> list[Path]:
    return [p for p in _walk(root) if p.name == "AndroidManifest.xml"]


def _manifest_has_layout_restrictions(text: str) -> bool:
    return bool(re.search(r'android:screenOrientation\s*=|android:resizeableActivity\s*=\s*["\']false["\']|android:(?:min|max)AspectRatio\s*=', text))


def _ensure_application_attr(text: str, attr: str, value: str) -> tuple[str, bool]:
    if re.search(rf'{re.escape(attr)}\s*=\s*["\'][^"\']+["\']', text):
        return text, False
    m = re.search(r"<application\b", text)
    if not m:
        return text, False
    insert = f' {attr}="{value}"'
    pos = m.end()
    return text[:pos] + insert + text[pos:], True


def _ensure_application_property(text: str, name: str, value: str) -> tuple[str, bool]:
    if name in text:
        return text, False
    m = re.search(r"<application\b[^>]*>", text, flags=re.S)
    if not m:
        return text, False
    prop = f'\n        <property android:name="{name}" android:value="{value}" />'
    return text[:m.end()] + prop + text[m.end():], True


def _patch_styles(root: Path, findings: list[Finding], changed_files: list[str]) -> None:
    for p in _walk(root):
        if p.suffix != ".xml" or "res" not in p.parts:
            continue
        original = p.read_text(encoding="utf-8", errors="ignore")
        updated = re.sub(
            r'\s*<item\s+name=["\']android:windowOptOutEdgeToEdgeEnforcement["\']\s*>\s*true\s*</item>\s*',
            "\n",
            original,
            flags=re.I,
        )
        if updated != original:
            p.write_text(updated, encoding="utf-8")
            changed_files.append(_rel(root, p))
            findings.append(Finding("EDGE_TO_EDGE_OPT_OUT", "warning", _rel(root, p), "Removed Android 16-disabled edge-to-edge opt-out.", True))


def _make_report_md(report: Report) -> str:
    lines = ["# Rescue36 report", "", f"Root: `{report.root}`", "", "## Changes"]
    if report.changed_files:
        lines += [f"- `{p}`" for p in sorted(set(report.changed_files))]
    else:
        lines.append("- No files changed.")
    lines += ["", "## Findings"]
    if report.findings:
        for f in report.findings:
            status = "fixed" if f.fixed else "review"
            lines.append(f"- **{f.severity.upper()} / {status} / {f.code}** `{f.path}` — {f.message}")
    else:
        lines.append("- No Android 16 migration findings.")
    lines += ["", "## Verification", "", "```json", json.dumps(report.build, indent=2), "```", ""]
    return "\n".join(lines)


def fix_project(root: Path, *, verify: bool = False) -> Report:
    root = root.resolve()
    findings: list[Finding] = []
    changed_files: list[str] = []
    old_agp_seen = False

    gradle_files = _gradle_files(root)
    if not gradle_files:
        findings.append(Finding("NO_GRADLE", "error", ".", "No Android Gradle build files found."))

    for p in gradle_files:
        original = p.read_text(encoding="utf-8", errors="ignore")
        updated, sdk_changed, saw_sdk = _patch_sdk_text(original)
        if sdk_changed:
            p.write_text(updated, encoding="utf-8")
            changed_files.append(_rel(root, p))
            findings.append(Finding("SDK_36", "info", _rel(root, p), "Updated compileSdk/targetSdk to API 36 where declared numerically.", True))
        elif not saw_sdk and ("com.android.application" in original or "com.android.library" in original or "android {" in original):
            findings.append(Finding("SDK_INDIRECT", "warning", _rel(root, p), "SDK version appears indirect or absent; version catalog/properties are checked separately."))
        agp_changed, old_agp = _patch_agp(p)
        old_agp_seen = old_agp_seen or old_agp
        if agp_changed:
            changed_files.append(_rel(root, p))
            findings.append(Finding("AGP_API36", "info", _rel(root, p), f"Upgraded Android Gradle Plugin to {SAFE_AGP} for API 36 support.", True))

    catalog = root / "gradle" / "libs.versions.toml"
    if catalog.exists() and _patch_version_catalog(catalog):
        changed_files.append(_rel(root, catalog))
        findings.append(Finding("VERSION_CATALOG", "info", _rel(root, catalog), "Updated Android SDK/AGP catalog values for API 36.", True))
        old_agp_seen = True

    wrapper = root / "gradle" / "wrapper" / "gradle-wrapper.properties"
    if wrapper.exists():
        if _patch_wrapper(wrapper):
            changed_files.append(_rel(root, wrapper))
            findings.append(Finding("GRADLE_API36", "info", _rel(root, wrapper), f"Upgraded Gradle wrapper to {SAFE_GRADLE}.", True))

    legacy_back = _detect_legacy_back(root)
    nonsdk = _detect_nonsdk(root)
    manifests = _manifest_files(root)

    for p in manifests:
        text = p.read_text(encoding="utf-8", errors="ignore")
        updated = text
        changed = False
        if legacy_back:
            updated, c = _ensure_application_attr(updated, "android:enableOnBackInvokedCallback", "false")
            changed |= c
            if c:
                findings.append(Finding("PREDICTIVE_BACK", "warning", _rel(root, p), "Added temporary predictive-back opt-out because legacy back handlers were detected.", True))
        if _manifest_has_layout_restrictions(updated):
            updated, c = _ensure_application_property(updated, "android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY", "true")
            changed |= c
            if c:
                findings.append(Finding("LARGE_SCREEN_COMPAT", "warning", _rel(root, p), "Added temporary Android 16 large-screen compatibility property for fixed orientation/resizability.", True))
        if changed:
            p.write_text(updated, encoding="utf-8")
            changed_files.append(_rel(root, p))

    for p in legacy_back:
        findings.append(Finding("LEGACY_BACK_HANDLER", "warning", _rel(root, p), "Legacy back interception found. Rescue36 preserved behavior via manifest opt-out; migrate to modern back APIs before API 37."))
    for p in nonsdk:
        findings.append(Finding("NON_SDK_API_RISK", "warning", _rel(root, p), "Reflection/non-SDK API usage detected; automatic replacement is unsafe, so this remains for review."))

    _patch_styles(root, findings, changed_files)

    build = {"attempted": False, "ok": None, "commands": [], "errors": []}
    if verify:
        build = verify_project(root)

    return Report(str(root), sorted(set(changed_files)), findings, build)


def scan_project(root: Path) -> Report:
    root = root.resolve()
    findings: list[Finding] = []
    for p in _gradle_files(root):
        text = p.read_text(encoding="utf-8", errors="ignore")
        for label, pat in [
            ("compileSdk", r"compileSdk(?:Version)?\s*(?:=\s*)?(\d+)"),
            ("targetSdk", r"targetSdk(?:Version)?\s*(?:=\s*)?(\d+)"),
        ]:
            m = re.search(pat, text)
            if m and int(m.group(1)) < TARGET_API:
                findings.append(Finding("SDK_BELOW_36", "error", _rel(root, p), f"{label} is {m.group(1)}; Google Play requires target API 36 for new apps/updates from 2026-08-31."))
    for p in _detect_legacy_back(root):
        findings.append(Finding("LEGACY_BACK_HANDLER", "warning", _rel(root, p), "Legacy back interception may break when targeting API 36."))
    for p in _detect_nonsdk(root):
        findings.append(Finding("NON_SDK_API_RISK", "warning", _rel(root, p), "Possible restricted non-SDK API access."))
    for p in _manifest_files(root):
        text = p.read_text(encoding="utf-8", errors="ignore")
        if _manifest_has_layout_restrictions(text):
            findings.append(Finding("LARGE_SCREEN_RESTRICTION", "warning", _rel(root, p), "Orientation/resizability/aspect constraints change on API 36 large screens."))
    return Report(str(root), [], findings, {"attempted": False, "ok": None, "commands": [], "errors": []})


def verify_project(root: Path) -> dict:
    gradlew = root / "gradlew"
    result = {"attempted": True, "ok": True, "commands": [], "errors": []}
    if not gradlew.exists():
        result["ok"] = False
        result["errors"].append("gradlew not found")
        return result
    try:
        gradlew.chmod(gradlew.stat().st_mode | 0o111)
    except OSError:
        pass

    commands = [
        [str(gradlew), "--no-daemon", "lint"],
        [str(gradlew), "--no-daemon", "test"],
        [str(gradlew), "--no-daemon", "assembleDebug"],
    ]
    for cmd in commands:
        result["commands"].append(" ".join(cmd[1:]))
        proc = subprocess.run(cmd, cwd=root, text=True, capture_output=True)
        if proc.returncode != 0:
            result["ok"] = False
            tail = (proc.stdout + "\n" + proc.stderr)[-12000:]
            result["errors"].append({"command": " ".join(cmd[1:]), "returncode": proc.returncode, "tail": tail})
            break
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="rescue36", description="Android 16 / API 36 migration rescue tool")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("scan", "fix", "verify"):
        p = sub.add_parser(name)
        p.add_argument("path", nargs="?", default=".")
        p.add_argument("--json", action="store_true")
        if name == "fix":
            p.add_argument("--verify", action="store_true")
            p.add_argument("--report", default="rescue36-report.md")
    args = parser.parse_args(argv)
    root = Path(args.path)
    if args.command == "scan":
        report = scan_project(root)
    elif args.command == "fix":
        report = fix_project(root, verify=args.verify)
        Path(args.report).write_text(_make_report_md(report), encoding="utf-8")
    else:
        report = Report(str(root.resolve()), [], [], verify_project(root.resolve()))

    print(report.to_json() if getattr(args, "json", False) else _make_report_md(report))
    if report.build.get("attempted") and report.build.get("ok") is False:
        return 2
    return 1 if any(f.severity == "error" and not f.fixed for f in report.findings) else 0


if __name__ == "__main__":
    raise SystemExit(main())

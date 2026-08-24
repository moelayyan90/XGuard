# Rescue36

Rescue36 is an automated Android 16 / API 36 migration and verification engine.

## What it fixes automatically

- `compileSdk` / `targetSdk` -> 36 when declared numerically.
- Android Gradle Plugin below API-36-compatible levels -> 8.10.2.
- Gradle wrapper below the required line -> 8.11.1.
- Removes `android:windowOptOutEdgeToEdgeEnforcement=true`, which no longer works for API 36 apps on Android 16.
- Detects legacy `onBackPressed()` / `KEYCODE_BACK` handling and adds the documented temporary predictive-back compatibility opt-out.
- Detects fixed orientation/resizability/aspect restrictions and adds the documented temporary large-screen compatibility property.
- Flags suspicious reflection/non-SDK API access for manual review because blindly rewriting it can break apps.
- Runs `lint`, unit tests and `assembleDebug` when verification is enabled.

## Local use

```bash
python rescue36.py scan /path/to/project
python rescue36.py fix /path/to/project --verify --report rescue36-report.md
```

## GitHub Action

```yaml
- uses: moelayyan90/XGuard/apps/rescue36@main
  with:
    path: .
    verify: 'true'
```

The action installs JDK 17 and Android SDK 36 on the GitHub-hosted runner, performs the migration, runs verification, and writes `rescue36-report.md`.

## Design principles

Rescue36 only auto-edits changes with a deterministic, reviewable transformation. It does not invent code for high-risk API migrations. Unsafe or project-specific cases are reported rather than silently rewritten.

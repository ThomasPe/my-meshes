# Microsoft Store release (APP-11)

How a Meshkeep version gets from a git tag to the Store, and what is decided where.

## Build flavors

| Flavor | Command | Updater | Package | Audience |
|---|---|---|---|---|
| Dev | `npm run tauri:dev` / `npm run tauri:build` | no | plain exe | development |
| Private | `npm run tauri:build:updater` | yes (`updater` feature, `tauri.updater.conf.json`) | NSIS installer + `latest.json` on GitHub Releases | the author and testers |
| Store | `npm run tauri:build:store` + `msix/build-msix.ps1` | no (`store` feature) | MSIX | Microsoft Store |

The Store build never contains the updater (spec `04-quality.md`): the `updater` cargo
feature is simply not compiled in, so there is no code path to hide at runtime. The
settings page shows "Updates arrive through the Microsoft Store" for Store builds.

## Dev channel (fast local iteration)

`.github/workflows/dev-channel.yml` turns every push to `main` or a working branch
(`claude/**`, `feat/**`, `fix/**`) into installable, self-updating Windows and macOS
builds without a local toolchain. One job per platform, both from the same commit:

1. Builds with `--features updater,devtools` and the dev overlay
   (`src-tauri/tauri.updater.dev.conf.json`: dev endpoint, channel `dev`), versioned
   `<package.json version>-dev.<run number>` so every build is newer than the last and
   older than the next stable release. LTO is off for this job; it takes about half the
   time of a release build. Windows produces the NSIS installer, macOS the `.app` bundle
   packed as `Meshkeep.app.tar.gz` (Apple Silicon only; `macos-latest` is an arm64
   runner. A universal build would also cover Intel Macs at twice the compile time).
2. Signs the artifact with the updater key and publishes it, its `.sig` and the
   platform's feed to the rolling pre-release tagged **`dev`**
   (`.github/scripts/dev-channel-publish.sh`). The feed is per platform:
   `latest-windows.json` and `latest-darwin.json`, selected by the `{{target}}`
   placeholder in the updater endpoint, so each job only replaces its own assets and a
   failed build on one platform leaves the other platform's feed intact. The Windows job
   also writes a plain `latest.json` for dev builds installed before the split; it can go
   once those have updated.
3. An installed dev build checks its feed once on startup and offers "Install and
   restart"; nothing installs without the click. Settings shows the channel badge and a
   manual check.

First install on Windows: download `Meshkeep_<version>_x64-setup.exe` from the `dev`
release once (SmartScreen warns because the installer is not code-signed; updates fetched
by the app do not trigger that prompt).

First install on macOS: download `Meshkeep.app.tar.gz`, unpack it and move `Meshkeep.app`
to Applications. The build is neither signed with a Developer ID nor notarized, so
Gatekeeper blocks the first launch (on macOS 15 the right-click "Open" workaround no
longer exists). Either open System Settings → Privacy & Security and click "Open Anyway"
below the message about Meshkeep, or clear the quarantine flag in a terminal:

```bash
xattr -d com.apple.quarantine /Applications/Meshkeep.app
```

Updates the app downloads itself carry no quarantine flag, so later dev builds install
without this step. Signing and notarization (Apple Developer Program, `APPLE_CERTIFICATE`,
`APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` secrets consumed by
`tauri build`) remove the Gatekeeper step and are the planned follow-up; the Mac App Store
build (spec `04-quality.md`, APP-11) is a separate, sandboxed flavor and not what the dev
channel ships. The dev channel is also the first place the app is built on macOS at all;
CI (`ci.yml`) still builds and tests the real app on Windows only.

From then on, push and restart the app; the release body names the branch and commit the
build came from.

The stable channel uses `src-tauri/tauri.updater.conf.json` (`releases/latest`) and is
produced by `release.yml` on tags. Store builds have no updater at all.

## Pipeline

`.github/workflows/release.yml` runs on every `v*` tag:

1. **Private installer.** `tauri-apps/tauri-action` builds the NSIS installer. When the
   secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` exist, the
   build carries the updater and the action publishes `latest.json` plus `.sig` files next
   to the installer, which is exactly what the in-app "Check for updates" reads.
2. **Store flavor.** `npm run tauri:build:store`, then `msix/build-msix.ps1 -Store` packs an
   **unsigned** MSIX for Partner Center (the Store signs on submission) with the identity
   from the repository variables `MSIX_IDENTITY_NAME`, `MSIX_PUBLISHER`,
   `MSIX_PUBLISHER_DISPLAY_NAME`.
3. **Side-load check.** The same exe is packed and self-signed, installed with
   `Add-AppxPackage`, launched through its AUMID, and removed (`msix/sideload-test.ps1`).
   CI does this on every push as well, so a broken manifest never reaches a release.
4. Both MSIX files are attached to the draft GitHub release.

## One-time setup

### Updater signing key (private builds)

Status: generated 2026-10-19 (minisign key id `0C7DD2E789BBD1C8`); the public key is in
both updater overlays, the private key and password are repository secrets
`TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

To rotate: `npx tauri signer generate -w ~/.tauri/meshkeep.key`, paste the **public** key
into `src-tauri/tauri.updater.conf.json` and `tauri.updater.dev.conf.json`, replace the
secrets. Never commit the private key; losing it means every installed private build
has to be reinstalled by hand once.

### Partner Center identity (Store builds)

Status: account created and the name **Meshkeep** reserved (2026-10-19); the domain
**meshkeep.app** is registered for the website, support and privacy-policy URLs.

1. ~~Create a Microsoft Partner Center developer account.~~ Done.
2. ~~Reserve the name "Meshkeep".~~ Done. Reservations last three months and are renewed
   by submitting.
3. Product management → Product identity shows three values. Put them into the repository
   variables (Settings → Secrets and variables → Actions → Variables):
   - `MSIX_IDENTITY_NAME` = `Package/Identity/Name` (looks like `12345DevSym.Meshkeep`)
   - `MSIX_PUBLISHER` = `Package/Identity/Publisher` (`CN=<GUID>`)
   - `MSIX_PUBLISHER_DISPLAY_NAME` = `Package/Properties/PublisherDisplayName`
4. Tag a release; upload `Meshkeep_<version>_x64_store.msix` from the release in the
   Packages step of the submission.

### Submission checklist

- Age rating questionnaire: no user-generated content, no purchases. Data collection by
  the publisher: none. Two optional features talk to third parties only on the user's
  action (AI assistance with the user's own API key; "Load model pages", off by default);
  both are described on the privacy page, which is the answer to the privacy questions.
- Privacy policy URL: `https://meshkeep.app/privacy/` (EN) and
  `https://meshkeep.app/de/datenschutz/` (DE), served from `site/` by `pages.yml`.
  Website `https://meshkeep.app`, support `https://meshkeep.app/support/`.
- `runFullTrust` capability: the submission form asks for a reason. Text: "Desktop app
  that indexes user-selected folders of 3D model files; file access is limited to folders
  the user picks through the system dialog."
- Screenshots: at least one 1366×768 or larger PNG per listing language; capture the
  library grid with thumbnails, the project page with the 3D viewer, and the import
  dialog. Store assets (tile logos) are generated into `msix/Assets` from
  `src-tauri/icons/icon.png`.
- Listing texts in `docs/store/listing.md`, English and German.

## Versioning

The MSIX version has four parts and must increase with every submission. The scripts use
`<package.json version>.0` by default; the release workflow derives it from the tag
(`v0.2.1` → `0.2.1.0`). Bump `version` in `package.json`, `src-tauri/tauri.conf.json` and
`Cargo.toml` together before tagging.

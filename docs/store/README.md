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

```bash
npx tauri signer generate -w ~/.tauri/meshkeep.key
```

- Paste the **public** key into `src-tauri/tauri.updater.conf.json` (`plugins.updater.pubkey`).
- Store the **private** key and its password as the GitHub secrets named above. Never
  commit the private key; losing it means every installed private build stops updating.

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

- Age rating questionnaire: no user-generated content, no purchases, no data collection.
- Privacy policy: the app is offline-only and collects nothing; the Store form needs a
  **URL**, so the text in `docs/store/listing.md` has to be published at
  `https://meshkeep.app/privacy` (a static page is enough). Website and support URL:
  `https://meshkeep.app`.
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

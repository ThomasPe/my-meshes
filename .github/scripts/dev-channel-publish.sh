#!/usr/bin/env bash
# Publishes one platform's dev build to the rolling `dev` pre-release (dev-channel.yml).
#
# Each platform has its own update feed (`latest-<target>.json`, selected by the
# `{{target}}` placeholder in the updater endpoint), so the Windows and macOS jobs run
# independently and only ever replace their own assets. Order per job: installer first,
# feed last, stale assets of the same platform afterwards. A client fetching its feed at
# any moment gets a complete release.
#
# Inputs (environment):
#   TARGET             windows | darwin
#   VERSION            <package.json version>-dev.<run number>
#   GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_REF_NAME, GH_TOKEN  (set by Actions)
#   DRY_RUN=1          only write dist-dev/, skip git and gh
set -euo pipefail

: "${TARGET:?}" "${VERSION:?}" "${GITHUB_REPOSITORY:?}" "${GITHUB_SHA:?}" "${GITHUB_REF_NAME:?}"

case "$TARGET" in
  windows)
    artifact=$(find target/release/bundle/nsis -name '*-setup.exe' | head -n 1)
    platforms='["windows-x86_64","windows-x86_64-nsis"]'
    # latest.json is the feed of dev builds installed before the per-platform split; they
    # update to a build that reads latest-windows.json and the duplicate can go away.
    feeds=(latest-windows.json latest.json)
    own='^(.*-setup\.exe(\.sig)?|latest\.json|latest-windows\.json)$'
    ;;
  darwin)
    artifact=$(find target/release/bundle/macos -name '*.app.tar.gz' | head -n 1)
    case "$(uname -m)" in
      arm64 | aarch64) platforms='["darwin-aarch64"]' ;;
      x86_64) platforms='["darwin-x86_64"]' ;;
      *) echo "::error::unknown macOS architecture $(uname -m)"; exit 1 ;;
    esac
    feeds=(latest-darwin.json)
    own='^(.*\.app\.tar\.gz(\.sig)?|latest-darwin\.json)$'
    ;;
  *)
    echo "::error::TARGET must be windows or darwin, got '$TARGET'"
    exit 1
    ;;
esac

if [[ -z "$artifact" ]]; then
  echo "::error::no updater artifact found for $TARGET"
  exit 1
fi
if [[ ! -f "$artifact.sig" ]]; then
  echo "::error::$artifact has no .sig; was the build signed with the updater key?"
  exit 1
fi

name=$(basename "$artifact")
url="https://github.com/$GITHUB_REPOSITORY/releases/download/dev/$name"
notes="Rolling development build from \`$GITHUB_REF_NAME\` @ \`$GITHUB_SHA\`.
Installed dev builds offer this on the next start. Not for the Store.

**Windows:** run \`Meshkeep_<version>_x64-setup.exe\`. SmartScreen warns once because the installer is not code-signed.

**macOS (Apple Silicon):** unpack \`Meshkeep.app.tar.gz\` and move \`Meshkeep.app\` to Applications. The build is not notarized, so the first launch is blocked: open System Settings → Privacy & Security and click \"Open Anyway\", or run \`xattr -d com.apple.quarantine /Applications/Meshkeep.app\`. Updates the app fetches itself do not need this again."

mkdir -p dist-dev
cp "$artifact" "$artifact.sig" dist-dev/
for feed in "${feeds[@]}"; do
  jq -n \
    --arg version "$VERSION" \
    --arg notes "$notes" \
    --arg pub_date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg signature "$(tr -d '\r\n' < "$artifact.sig")" \
    --arg url "$url" \
    --argjson keys "$platforms" \
    '{version: $version, notes: $notes, pub_date: $pub_date,
      platforms: ($keys | map({key: ., value: {signature: $signature, url: $url}}) | from_entries)}' \
    > "dist-dev/$feed"
done
cat "dist-dev/${feeds[0]}"

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  echo "dry run: not publishing"
  exit 0
fi

title="Dev channel $VERSION"
git tag -f dev "$GITHUB_SHA"
git push -f origin refs/tags/dev

if ! gh release view dev --json id > /dev/null 2>&1; then
  # The other platform's job may create the release at the same moment; the uploads
  # below work either way.
  gh release create dev --prerelease --title "$title" --notes "$notes" || true
fi
gh release upload dev "dist-dev/$name" "dist-dev/$name.sig" --clobber
for feed in "${feeds[@]}"; do
  gh release upload dev "dist-dev/$feed" --clobber
done
gh release edit dev --prerelease --title "$title" --notes "$notes" --target "$GITHUB_SHA"

# Remove this platform's assets from earlier builds (REST ids, not the node ids
# `gh release view` prints). The other platform's assets are never touched.
keep=("$name" "$name.sig" "${feeds[@]}")
gh api "repos/$GITHUB_REPOSITORY/releases/tags/dev" --jq '.assets[] | "\(.id) \(.name)"' |
  while read -r id asset; do
    [[ "$asset" =~ $own ]] || continue
    for k in "${keep[@]}"; do [[ "$asset" == "$k" ]] && continue 2; done
    echo "removing stale asset $asset"
    gh api -X DELETE "repos/$GITHUB_REPOSITORY/releases/assets/$id" > /dev/null
  done

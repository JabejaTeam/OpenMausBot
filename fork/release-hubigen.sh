#!/usr/bin/env bash
# Jabeja fork only: release Hubigen to the team. Raises the release number in
# shared/product.json, builds a notarized dmg + zip (fork/build-hubigen.sh with
# HUBIGEN_RELEASE=1), uploads them with latest-mac.yml to the download site,
# and refreshes its page. Every installed Hubigen app picks the update up by
# itself (product.json updateFeed).
#
# Needs, on this Mac only:
# - the Developer ID "Jabeja (4DK89S8Z2F)" in the keychain (signing)
# - ~/.config/hubigen/notary.env with APPLE_API_KEY (path to the .p8),
#   APPLE_API_KEY_ID and APPLE_API_ISSUER (App Store Connect → Users and
#   Access → Integrations → Keys); paths and ids only, the key stays a file
#
#   fork/release-hubigen.sh
set -euo pipefail
cd "$(dirname "$0")/.."
VPS=jabeja-vps-root
SITE=/opt/hubigen-download/public

[ -z "$(git status --porcelain)" ] || { echo "commit first: the working tree is dirty" >&2; exit 1; }
set -a; . "$HOME/.config/hubigen/notary.env"; set +a
for v in APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER; do [ -n "${!v:-}" ] || { echo "$v missing in ~/.config/hubigen/notary.env" >&2; exit 1; }; done
[ -f "$APPLE_API_KEY" ] || { echo "no key file at $APPLE_API_KEY" >&2; exit 1; }

# the release number is part of the version: claim it on fork main BEFORE the
# long build, so a session that pushes meanwhile cannot make two builds share
# a number (happened twice on 2026-10-11 when the push came last)
git fetch -q fork && git rebase -q fork/main
node -e '
  const fs = require("fs"); const f = "shared/product.json";
  const p = JSON.parse(fs.readFileSync(f, "utf8")); p.release += 1;
  fs.writeFileSync(f, JSON.stringify(p, null, 2) + "\n");'
name=$(node -p 'require("./shared/product.json").name')
version="$(node -p 'require("./package.json").version')-hubigen.$(node -p 'require("./shared/product.json").release')"
git commit -q -m "release: $name $version" shared/product.json
git push -q fork HEAD:main || { echo "could not claim release $version on fork main; nothing built" >&2; exit 1; }

rm -f release/"$name"-*.dmg release/"$name"-*.zip release/*.blockmap release/latest-mac.yml
HUBIGEN_RELEASE=1 bash fork/build-hubigen.sh
dmg="$name-$version-arm64.dmg"
[ -f "release/$dmg" ] && [ -f release/latest-mac.yml ] || { echo "build left no $dmg or latest-mac.yml" >&2; exit 1; }
xcrun stapler validate "release/mac-arm64/$name.app"
# the app must look for updates on Hubigen's own feed, and that feed list
# only this Mac's files (releases 1–3 shipped upstream's GitHub feed)
feed=$(node -p 'require("./shared/product.json").updateFeed')
grep -qx "provider: generic" "release/mac-arm64/$name.app/Contents/Resources/app-update.yml" \
  && grep -qx "url: $feed" "release/mac-arm64/$name.app/Contents/Resources/app-update.yml" \
  || { echo "app-update.yml does not point at $feed:" >&2; cat "release/mac-arm64/$name.app/Contents/Resources/app-update.yml" >&2; exit 1; }
! grep -q "^channel:" "release/mac-arm64/$name.app/Contents/Resources/app-update.yml" || { echo "app-update.yml names a channel; the app would not read latest-mac.yml" >&2; exit 1; }
! grep -q -- "-x64\." release/latest-mac.yml || { echo "latest-mac.yml lists x64 files" >&2; exit 1; }
# The app inside is notarized by the build; the dmg people download is checked
# by macOS too, so it gets its own ticket. Stapling changes the file, so its
# entry in latest-mac.yml is recomputed.
xcrun notarytool submit "release/$dmg" --key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" --wait
xcrun stapler staple "release/$dmg"
node --input-type=module -e '
  import { readFileSync, writeFileSync, statSync } from "node:fs";
  import { createHash } from "node:crypto";
  import { parse, stringify } from "yaml";
  const [file, dmg] = process.argv.slice(1);
  const feed = parse(readFileSync(file, "utf8"));
  feed.files = feed.files.filter((entry, i) => feed.files.findIndex((other) => other.url === entry.url) === i);
  for (const entry of feed.files) if (entry.url === dmg) {
    entry.sha512 = createHash("sha512").update(readFileSync("release/" + dmg)).digest("base64");
    entry.size = statSync("release/" + dmg).size;
  }
  writeFileSync(file, stringify(feed));' release/latest-mac.yml "$dmg"
spctl -a -t install "release/$dmg"

# the files first, the feed last: an updater never sees a version whose zip is not there yet
ssh "$VPS" "mkdir -p $SITE/mac"
rsync -a release/"$name-$version"-arm64.{dmg,zip} release/"$name-$version"-arm64.*.blockmap "$VPS:$SITE/mac/"
rsync -a release/latest-mac.yml "$VPS:$SITE/mac/latest-mac.yml"
sed -e "s/{{name}}/$name/g" -e "s/{{version}}/$version/g" -e "s/{{dmg}}/$dmg/g" fork/hubigen/download.html > release/index.html
rsync -a release/index.html "$VPS:$SITE/index.html"
rsync -a fork/hubigen/icon-1024.png "$VPS:$SITE/icon.png"
# older versions go: the feed and the page only point at this one
ssh "$VPS" "find $SITE/mac -maxdepth 1 -name '$name-*' ! -name '$name-$version-*' -delete"
echo "released $name $version: $(node -p 'require("./shared/product.json").downloads')"

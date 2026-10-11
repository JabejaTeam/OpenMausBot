// Jabeja fork only: the Hubigen desktop app. Upstream's electron-builder.yml
// stays untouched (fork-sync never conflicts here); this reads it and
// replaces what Hubigen does differently, from shared/product.json — the one
// place the name, bundle id, update feed and release number live.
// Not electron-builder's `extends`: it ADDS list values to upstream's instead
// of replacing them, which put upstream's GitHub feed first in
// app-update.yml (releases 1–3 could never update) and built x64 too.
// Build: fork/build-hubigen.sh; release (notarized, uploaded): fork/release-hubigen.sh.
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const product = JSON.parse(readFileSync(new URL("../shared/product.json", import.meta.url), "utf8"));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const upstream = parse(readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8"));
const name = product.name;
// Upstream's version plus our release number: 0.1.104-hubigen.3. The updater
// orders these right, also across an upstream bump (0.1.105-hubigen.4).
const version = `${pkg.version}-hubigen.${product.release}`;
const release = process.env.HUBIGEN_RELEASE === "1";

export default {
  ...upstream,
  appId: product.appId,
  productName: name,
  extraMetadata: { version },
  artifactName: `${name}-\${version}-\${arch}.\${ext}`,
  // Updates only from Hubigen's own feed (the generic provider reads
  // latest-mac.yml there), never upstream's releases.
  publish: [{ provider: "generic", url: product.updateFeed }],
  mac: {
    ...upstream.mac,
    target: release ? [{ target: "dmg", arch: ["arm64"] }, { target: "zip", arch: ["arm64"] }] : [{ target: "dir", arch: ["arm64"] }],
    icon: "fork/hubigen/icon.icns",
    identity: "Jabeja (4DK89S8Z2F)",
    // Apple's notary service, with the App Store Connect key in
    // APPLE_API_KEY / APPLE_API_KEY_ID / APPLE_API_ISSUER (release only)
    notarize: release,
    extendInfo: {
      NSMicrophoneUsageDescription: `${name} uses the microphone for voice dictation into the composer.`,
      NSSpeechRecognitionUsageDescription: `${name} transcribes your voice on-device to type messages for you.`,
      NSAccessibilityUsageDescription: `${name} uses Accessibility when you let a bot control this Mac.`,
      NSScreenCaptureUsageDescription: `${name} uses Screen Recording so bots can see this Mac before acting.`,
    },
  },
  dmg: { ...upstream.dmg, artifactName: `${name}-\${version}-\${arch}.dmg` },
};

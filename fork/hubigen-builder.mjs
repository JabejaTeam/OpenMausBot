// Jabeja fork only: the Hubigen desktop app. Upstream's electron-builder.yml
// stays untouched (fork-sync never conflicts here); this extends it with the
// product from shared/product.json, the one place the name and bundle id live.
// Build: fork/build-hubigen.sh
import { readFileSync } from "node:fs";

const product = JSON.parse(readFileSync(new URL("../shared/product.json", import.meta.url), "utf8"));
const name = product.name;

export default {
  extends: "electron-builder.yml",
  appId: product.appId,
  productName: name,
  artifactName: `${name}-\${version}-\${arch}.\${ext}`,
  // Updates only from Hubigen's own feed, never upstream's releases: without
  // a feed the app has no app-update.yml and never updates itself.
  publish: product.updateFeed ? [{ provider: "generic", url: product.updateFeed }] : null,
  mac: {
    icon: "fork/hubigen/icon.icns",
    identity: "Jabeja (4DK89S8Z2F)",
    extendInfo: {
      NSMicrophoneUsageDescription: `${name} uses the microphone for voice dictation into the composer.`,
      NSSpeechRecognitionUsageDescription: `${name} transcribes your voice on-device to type messages for you.`,
      NSAccessibilityUsageDescription: `${name} uses Accessibility when you let a bot control this Mac.`,
      NSScreenCaptureUsageDescription: `${name} uses Screen Recording so bots can see this Mac before acting.`,
    },
  },
  dmg: { artifactName: `${name}-\${version}-\${arch}.dmg` },
};

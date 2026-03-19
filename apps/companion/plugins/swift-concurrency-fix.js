/**
 * Expo config plugin that patches the Podfile post_install to disable
 * Swift 6 strict concurrency checking on all pods.
 *
 * This fixes expo-image 55.x compilation on Xcode 16.4+ which enables
 * strict concurrency by default, causing 36+ build errors.
 *
 * This plugin survives `npx expo prebuild --clean`.
 */
const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

module.exports = function swiftConcurrencyFix(config) {
  return withDangerousMod(config, [
    "ios",
    (config) => {
      const podfilePath = path.join(
        config.modRequest.platformProjectRoot,
        "Podfile"
      );
      let podfile = fs.readFileSync(podfilePath, "utf8");

      const patch = `
    # [swift-concurrency-fix plugin] Xcode 16.4+ enables Swift 6 strict
    # concurrency by default, breaking expo-image and other pods.
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |bc|
        bc.build_settings['SWIFT_STRICT_CONCURRENCY'] = 'minimal'
        bc.build_settings['SWIFT_VERSION'] = '5.0'
      end
    end`;

      // Insert before the closing `end` of post_install
      if (!podfile.includes("SWIFT_STRICT_CONCURRENCY")) {
        podfile = podfile.replace(
          /(\s*react_native_post_install\([^)]*\))\s*\n(\s*end\s*\nend)/,
          `$1\n${patch}\n$2`
        );
        fs.writeFileSync(podfilePath, podfile, "utf8");
      }

      return config;
    },
  ]);
};

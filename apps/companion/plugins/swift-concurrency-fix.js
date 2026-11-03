/**
 * Expo config plugin that sets SWIFT_STRICT_CONCURRENCY=minimal and
 * SWIFT_VERSION=5.0 on every pod in the Podfile's post_install.
 *
 * Xcode 16.4+ turns on Swift 6 strict concurrency by default, and some pods do
 * not compile under it. The settings go right after the
 * react_native_post_install(...) call; the plugin throws if that call is
 * missing, so a template change fails `npx expo prebuild --clean` loudly.
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
    # [swift-concurrency-fix plugin] Xcode 16.4+ turns on Swift 6 strict
    # concurrency by default, and some pods do not compile under it.
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |bc|
        bc.build_settings['SWIFT_STRICT_CONCURRENCY'] = 'minimal'
        bc.build_settings['SWIFT_VERSION'] = '5.0'
      end
    end`;

      // Insert right after the react_native_post_install(...) call. Its
      // arguments hold calls of their own (`ccache_enabled?(...)`), so the
      // pattern allows one level of nested parentheses.
      if (!podfile.includes("SWIFT_STRICT_CONCURRENCY")) {
        const postInstallCall =
          /(react_native_post_install\((?:[^()]|\([^()]*\))*\))/;
        if (!postInstallCall.test(podfile)) {
          throw new Error(
            "[swift-concurrency-fix] react_native_post_install(...) not found in the Podfile"
          );
        }
        podfile = podfile.replace(postInstallCall, `$1\n${patch}`);
        fs.writeFileSync(podfilePath, podfile, "utf8");
      }

      return config;
    },
  ]);
};

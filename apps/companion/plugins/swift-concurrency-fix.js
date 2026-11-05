/**
 * Expo config plugin that sets SWIFT_STRICT_CONCURRENCY=minimal and
 * SWIFT_VERSION=5.0 on every pod in the Podfile's post_install.
 *
 * Xcode 16.4+ turns on Swift 6 strict concurrency by default, and some pods do
 * not compile under it. The settings go right after the
 * react_native_post_install(...) call; the plugin throws if that call is
 * missing, so a template change fails `npx expo prebuild --clean` loudly.
 *
 * @see {@link file://./swift-concurrency-fix.test.cjs}
 */
const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

/** Marks the inserted block, so the plugin can tell it already ran. */
const MARKER = "# [swift-concurrency-fix plugin]";

const PATCH = `
    ${MARKER} Xcode 16.4+ turns on Swift 6 strict
    # concurrency by default, and some pods do not compile under it.
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |bc|
        bc.build_settings['SWIFT_STRICT_CONCURRENCY'] = 'minimal'
        bc.build_settings['SWIFT_VERSION'] = '5.0'
      end
    end`;

/**
 * The react_native_post_install(...) call. Its arguments hold calls of their
 * own (`ccache_enabled?(...)`), so the pattern allows one level of nested
 * parentheses.
 */
const POST_INSTALL_CALL =
  /(react_native_post_install\((?:[^()]|\([^()]*\))*\))/;

/**
 * Returns the Podfile with the Swift settings inserted right after the
 * react_native_post_install(...) call. A Podfile that already holds the
 * plugin's block comes back unchanged, so running it twice is safe.
 *
 * @param {string} podfile - Podfile contents
 * @returns {string} the patched Podfile
 * @throws {Error} when the Podfile has no react_native_post_install(...) call
 */
function addSwiftConcurrencySettings(podfile) {
  if (podfile.includes(MARKER)) return podfile;
  if (!POST_INSTALL_CALL.test(podfile)) {
    throw new Error(
      "[swift-concurrency-fix] react_native_post_install(...) not found in the Podfile"
    );
  }
  return podfile.replace(POST_INSTALL_CALL, `$1\n${PATCH}`);
}

module.exports = function swiftConcurrencyFix(config) {
  return withDangerousMod(config, [
    "ios",
    (config) => {
      const podfilePath = path.join(
        config.modRequest.platformProjectRoot,
        "Podfile"
      );
      const podfile = fs.readFileSync(podfilePath, "utf8");
      const patched = addSwiftConcurrencySettings(podfile);
      if (patched !== podfile) fs.writeFileSync(podfilePath, patched, "utf8");
      return config;
    },
  ]);
};

module.exports.addSwiftConcurrencySettings = addSwiftConcurrencySettings;

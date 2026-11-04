/**
 * Tests for the swift-concurrency-fix plugin's Podfile patching.
 *
 * Runs under node:test with the companion tests: `pnpm --filter
 * @shelf/companion test`.
 *
 * @see {@link file://./swift-concurrency-fix.js}
 */

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { addSwiftConcurrencySettings } = require("./swift-concurrency-fix.js");

/** The post_install block of the Expo SDK 58 Podfile template. */
const SDK_58_POST_INSTALL = `  post_install do |installer|
    react_native_post_install(
      installer,
      config[:reactNativePath],
      :mac_catalyst_enabled => false,
      :ccache_enabled => ccache_enabled?(podfile_properties),
    )
  end
end
`;

describe("addSwiftConcurrencySettings", () => {
  it("inserts the settings after a call with a nested call in its arguments", () => {
    const patched = addSwiftConcurrencySettings(SDK_58_POST_INSTALL);

    const callEnd = patched.indexOf(
      ":ccache_enabled => ccache_enabled?(podfile_properties),\n    )"
    );
    const settings = patched.indexOf(
      "bc.build_settings['SWIFT_STRICT_CONCURRENCY'] = 'minimal'"
    );
    assert.ok(callEnd > -1, "the call is kept intact");
    assert.ok(settings > callEnd, "the settings follow the call");
    assert.ok(
      patched.includes("bc.build_settings['SWIFT_VERSION'] = '5.0'"),
      "SWIFT_VERSION is set"
    );
    assert.ok(patched.trimEnd().endsWith("end\nend"), "the blocks still close");
  });

  it("throws when the Podfile has no react_native_post_install call", () => {
    assert.throws(
      () => addSwiftConcurrencySettings("target 'Shelf' do\nend\n"),
      /react_native_post_install\(\.\.\.\) not found/
    );
  });

  it("changes nothing on a second run", () => {
    const once = addSwiftConcurrencySettings(SDK_58_POST_INSTALL);
    assert.equal(addSwiftConcurrencySettings(once), once);
  });
});

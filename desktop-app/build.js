const createDMG = require("electron-installer-dmg");
const { signAsync } = require("@electron/osx-sign");
const electronInstaller = require("electron-winstaller");
const {execa} = require("@esm2cjs/execa");

const NATIVEFIER_APPS_DIR = "./dist";
const URL = "https://app.shelf.nu";
const NAME = "Shelf";
const ICON_MAC = "../public/images/shelf-symbol-desktop.png";
const ICON_WINDOWS = "../public/images/shelf-symbol-desktop.ico";

async function buildMac() {
  try {
    await execa(
      "nativefier",
      [
        URL,
        "--name",NAME, 
        "--icon", ICON_MAC,
        "--platform", "osx",
        "--arch", "universal",
      ],
      { env: { NATIVEFIER_APPS_DIR } }
    );
    console.log("Mac build successful");

    await signAsync({
      app: "./dist/Shelf-darwin-universal/Shelf.app",
      platform: "darwin",
      type: "distribution",
    });
    console.log("Signed macOS App successfully");

    await createDMG({
      appPath: "./dist/Shelf-darwin-universal/Shelf.app",
      name: "Shelf",
      icon: "../public/images/shelf-symbol-desktop.png",
      overwrite: true,
      out: "./binaries",
    });
    console.log("Succesfully packaged Mac App");
  } catch (error) {
    console.error("Error building for Mac:", error);
  }
}

async function buildWindows() {
  try {
    await execa(
      "nativefier",
      [
        URL, 
        "--name", NAME, 
        "--icon", ICON_WINDOWS, 
        "--platform", "windows"
      ],
      { env: { NATIVEFIER_APPS_DIR } }
    );
    await electronInstaller.createWindowsInstaller({
      appDirectory: "./dist/Shelf-win32-x64",
      outputDirectory: "./binaries",
      authors: "Shelf",
      exe: "Shelf.exe",
    });
    console.log("Windows build successful");
  } catch (error) {
    console.error("Error building for Windows:", error);
  }
};

(async () => {
  await buildMac()
  await buildWindows()
})();

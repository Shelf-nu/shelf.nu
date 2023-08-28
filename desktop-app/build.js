/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { signAsync } = require("@electron/osx-sign");
const { execa } = require("@esm2cjs/execa");
const createDMG = require("electron-installer-dmg");
const electronInstaller = require("electron-winstaller");

const URL = "https://app.shelf.nu";
const APP_NAME = "Shelf";
const APP_ICON = "../public/images/shelf-symbol-desktop";
const NATIVEFIER_APPS_DIR = "./portable";
const OUT_DIR_MAC = `./${NATIVEFIER_APPS_DIR}/Shelf-darwin-universal/Shelf.app`
const OUT_DIR_WINDOWS = `./${NATIVEFIER_APPS_DIR}/Shelf-win32-x64`
const INSTALL_DIR = "./shelf-installer"


async function buildMac() {
  try {
    await execa(
      "nativefier",
      [
        URL,
        "--name", APP_NAME,
        "--icon", `${APP_ICON}.png`,
        "--platform", "osx",
        "--arch", "universal",
      ],
      { env: { NATIVEFIER_APPS_DIR } }
    );
    console.log("Mac build successful");

    await signAsync({
      app: OUT_DIR_MAC,
      platform: "darwin",
      type: "distribution",
    });
    console.log("Signed macOS App successfully");

    await createDMG({
      appPath: OUT_DIR_MAC,
      name: APP_NAME,
      icon: "../public/images/shelf-symbol-desktop.png",
      overwrite: true,
      out: INSTALL_DIR,
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
        "--name", APP_NAME,
        "--icon", `${APP_ICON}.ico`,
        "--platform", "windows"
      ],
      { env: { NATIVEFIER_APPS_DIR } }
    );
    await electronInstaller.createWindowsInstaller({
      title: APP_NAME,
      name: APP_NAME,
      appDirectory: OUT_DIR_WINDOWS,
      outputDirectory: INSTALL_DIR,
      description: 'Install Shelf',
      setupIcon: `${OUT_DIR_WINDOWS}/resources/app/icon.ico`,
      authors: APP_NAME,
      exe: `${APP_NAME}.exe`,
    });
    console.log("Windows build successful");
  } catch (error) {
    console.error("Error building for Windows:", error);
  }
};

(async () => {
  if (process.argv.includes('--mac')) return await buildMac()
  if (process.argv.includes('--windows')) {
    await buildWindows();
    fs.readdir(INSTALL_DIR, (err, files) => {
      if (err) throw err;
      for (const file of files) {
        if(path.extname(file) !== '.exe') {
          fs.unlink(path.join(INSTALL_DIR, file), err => {
            if (err) throw err;
          });
        }
      }
    });
  } 
})();
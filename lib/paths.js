const { app } = require("electron");
const path = require("path");

const platform = process.platform;

function defaultInstallDir() {
  if (platform === "win32") {
    return path.join(app.getPath("documents"), "ComfyUI");
  }
  if (platform === "darwin") {
    return path.join(app.getPath("home"), "ComfyUI");
  }
  // linux and others
  return path.join(app.getPath("home"), "ComfyUI");
}

module.exports = { defaultInstallDir };

const { app } = require("electron");
const path = require("path");

const platform = process.platform;

function defaultInstallDir() {
  return path.join(app.getPath("home"), "ComfyUI-Installs");
}

module.exports = { defaultInstallDir };

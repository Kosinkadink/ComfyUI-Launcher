const path = require("path");
const fs = require("fs");

const localesDir = path.join(__dirname, "..", "locales");

let currentLocale = "en";
let messages = {};

function loadLocaleFile(locale) {
  const filePath = path.join(localesDir, `${locale}.json`);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function init(locale) {
  currentLocale = locale || "en";
  messages = loadLocaleFile(currentLocale);
  if (!messages) {
    currentLocale = "en";
    messages = loadLocaleFile("en") || {};
  }
}

function t(key, params) {
  const parts = key.split(".");
  let val = messages;
  for (const p of parts) {
    if (val == null || typeof val !== "object") return key;
    val = val[p];
  }
  if (typeof val !== "string") return key;
  if (params) {
    return val.replace(/\{(\w+)\}/g, (_, k) =>
      params[k] !== undefined ? params[k] : `{${k}}`
    );
  }
  return val;
}

function getMessages() {
  return messages;
}

function getLocale() {
  return currentLocale;
}

function getAvailableLocales() {
  try {
    const files = fs.readdirSync(localesDir).filter((f) => f.endsWith(".json"));
    return files.map((f) => {
      const loc = f.replace(/\.json$/, "");
      const data = loadLocaleFile(loc);
      return { value: loc, label: (data && data._label) || loc };
    });
  } catch {
    return [];
  }
}

module.exports = { init, t, getMessages, getLocale, getAvailableLocales };

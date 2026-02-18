const path = require("path");
const fs = require("fs");

const localesDir = path.join(__dirname, "..", "locales");

let currentLocale = "en";
let fallback = {};
let messages = {};

function loadLocaleFile(locale) {
  const filePath = path.join(localesDir, `${locale}.json`);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function deepMerge(base, override) {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (
      typeof result[key] === "object" && result[key] !== null &&
      typeof override[key] === "object" && override[key] !== null
    ) {
      result[key] = deepMerge(result[key], override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

function init(locale) {
  currentLocale = locale || "en";
  fallback = loadLocaleFile("en") || {};
  const localeMessages = currentLocale !== "en" ? loadLocaleFile(currentLocale) : null;
  messages = localeMessages ? deepMerge(fallback, localeMessages) : fallback;
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

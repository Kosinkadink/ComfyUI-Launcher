const { app } = require("electron");
const path = require("path");
const fs = require("fs");

const dataPath = path.join(app.getPath("userData"), "installations.json");

function load() {
  try {
    return JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  } catch {
    return [];
  }
}

function save(installations) {
  fs.mkdirSync(path.dirname(dataPath), { recursive: true });
  fs.writeFileSync(dataPath, JSON.stringify(installations, null, 2));
}

function list() {
  return load();
}

function add(installation) {
  const installations = load();
  const entry = {
    id: `inst-${Date.now()}`,
    createdAt: new Date().toISOString(),
    ...installation,
  };
  installations.push(entry);
  save(installations);
  return entry;
}

function remove(id) {
  const installations = load().filter((i) => i.id !== id);
  save(installations);
}

function update(id, data) {
  const installations = load();
  const index = installations.findIndex((i) => i.id === id);
  if (index === -1) return null;
  installations[index] = { ...installations[index], ...data };
  save(installations);
  return installations[index];
}

function get(id) {
  return load().find((i) => i.id === id) || null;
}

module.exports = { list, add, remove, update, get };

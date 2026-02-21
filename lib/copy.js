const fs = require("fs");
const path = require("path");
const { formatTime } = require("./util");

async function collectFiles(dir) {
  const entries = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    const items = await fs.promises.readdir(current, { withFileTypes: true });
    for (const item of items) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) {
        stack.push(full);
      } else {
        entries.push(path.relative(dir, full));
      }
    }
  }
  return entries;
}

async function copyDirWithProgress(src, dest, onProgress) {
  const files = await collectFiles(src);
  const total = files.length;
  let copied = 0;
  const step = Math.max(1, Math.floor(total / 100));
  const concurrency = 50;
  const dirPromises = new Map();
  const startTime = Date.now();

  const ensureDir = (dir) => {
    if (dirPromises.has(dir)) return dirPromises.get(dir);
    const p = fs.promises.mkdir(dir, { recursive: true });
    dirPromises.set(dir, p);
    return p;
  };

  let i = 0;
  while (i < files.length) {
    const batch = files.slice(i, i + concurrency);
    await Promise.all(batch.map(async (rel) => {
      const destPath = path.join(dest, rel);
      await ensureDir(path.dirname(destPath));
      await fs.promises.copyFile(path.join(src, rel), destPath);
      copied++;
      if (onProgress && (copied % step === 0 || copied === total)) {
        const elapsedSecs = (Date.now() - startTime) / 1000;
        const etaSecs = copied > 0 ? elapsedSecs * ((total - copied) / copied) : -1;
        onProgress(copied, total, elapsedSecs, etaSecs);
      }
    }));
    i += concurrency;
  }
}

module.exports = { collectFiles, copyDirWithProgress };

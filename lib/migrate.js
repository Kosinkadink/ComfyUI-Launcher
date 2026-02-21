const fs = require("fs");
const path = require("path");

/**
 * List custom node directories in a ComfyUI custom_nodes/ folder.
 * Returns an array of { name, dir, hasRequirements }.
 */
function listCustomNodes(customNodesDir) {
  if (!fs.existsSync(customNodesDir)) return [];
  try {
    return fs.readdirSync(customNodesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "__pycache__")
      .map((d) => {
        const dir = path.join(customNodesDir, d.name);
        const reqPath = path.join(dir, "requirements.txt");
        return { name: d.name, dir, hasRequirements: fs.existsSync(reqPath) };
      });
  } catch {
    return [];
  }
}

/**
 * Locate the ComfyUI directory inside an installation path.
 * Handles standalone (installPath/ComfyUI) and portable
 * (installPath/<subdir>/ComfyUI where <subdir> contains python_embeded).
 * Returns the absolute path or null if not found.
 */
function findComfyUIDir(installPath) {
  const direct = path.join(installPath, "ComfyUI");
  if (fs.existsSync(direct)) return direct;
  try {
    const entries = fs.readdirSync(installPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const sub = path.join(installPath, entry.name);
        if (fs.existsSync(path.join(sub, "python_embeded"))) {
          const comfyDir = path.join(sub, "ComfyUI");
          if (fs.existsSync(comfyDir)) return comfyDir;
        }
      }
    }
  } catch {}
  return null;
}

/**
 * Backup a directory by renaming it with a timestamp suffix.
 * Returns the backup path, or null if the source doesn't exist.
 */
function backupDir(dirPath) {
  if (!fs.existsSync(dirPath)) return null;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupPath = `${dirPath}.bak-${timestamp}`;
  fs.renameSync(dirPath, backupPath);
  return backupPath;
}

/**
 * Merge files from src into dest, skipping files that already exist.
 * Walks the directory tree recursively; only copies files missing at dest.
 * Calls onProgress(copied, skipped, total) periodically.
 */
async function mergeDirFlat(src, dest, onProgress) {
  const { collectFiles } = require("./copy");
  const { files, symlinks } = await collectFiles(src);
  const total = files.length + symlinks.length;
  let copied = 0;
  let skipped = 0;
  const step = Math.max(1, Math.floor(total / 100));
  const concurrency = 50;

  let i = 0;
  while (i < files.length) {
    const batch = files.slice(i, i + concurrency);
    await Promise.all(batch.map(async (rel) => {
      const srcPath = path.join(src, rel);
      const stat = await fs.promises.stat(srcPath);
      if (stat.size === 0) { skipped++; }
      else {
        const destPath = path.join(dest, rel);
        if (fs.existsSync(destPath)) {
          skipped++;
        } else {
          await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
          await fs.promises.copyFile(srcPath, destPath);
          copied++;
        }
      }
      if (onProgress && ((copied + skipped) % step === 0 || copied + skipped === total)) {
        onProgress(copied, skipped, total);
      }
    }));
    i += concurrency;
  }

  // Recreate symlinks, rewriting absolute targets that point inside src
  for (const rel of symlinks) {
    const destLink = path.join(dest, rel);
    if (fs.existsSync(destLink)) { skipped++; }
    else {
      const srcLink = path.join(src, rel);
      await fs.promises.mkdir(path.dirname(destLink), { recursive: true });
      let target = await fs.promises.readlink(srcLink);
      if (path.isAbsolute(target)) {
        const relToSrc = path.relative(src, target);
        if (!relToSrc.startsWith("..") && !path.isAbsolute(relToSrc)) {
          target = path.join(dest, relToSrc);
        }
      }
      try {
        await fs.promises.symlink(target, destLink);
        copied++;
      } catch { skipped++; }
    }
    if (onProgress && ((copied + skipped) % step === 0 || copied + skipped === total)) {
      onProgress(copied, skipped, total);
    }
  }

  return { copied, skipped };
}

module.exports = { listCustomNodes, findComfyUIDir, backupDir, mergeDirFlat };

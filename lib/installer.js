const fs = require("fs");
const path = require("path");
const { formatTime } = require("./util");
const { t } = require("./i18n");

async function downloadAndExtract(url, dest, cacheKey, { sendProgress, download, cache, extract }) {
  const filename = url.split("/").pop();
  const cacheBase = cache.getCachePath(cacheKey);
  fs.mkdirSync(cacheBase, { recursive: true });
  const cachePath = path.join(cacheBase, filename);

  if (fs.existsSync(cachePath)) {
    sendProgress("download", { percent: 100, status: t("installer.cachedDownload") });
    cache.touch(cacheKey);
  } else {
    sendProgress("download", { percent: 0, status: t("installer.startingDownload") });
    await download(url, cachePath, (p) => {
      const speed = `${p.speedMBs.toFixed(1)} MB/s`;
      const elapsed = formatTime(p.elapsedSecs);
      const eta = p.etaSecs >= 0 ? formatTime(p.etaSecs) : "—";
      sendProgress("download", {
        percent: p.percent,
        status: t("installer.downloading", { progress: `${p.receivedMB} / ${p.totalMB} MB  ·  ${speed}  ·  ${elapsed} elapsed  ·  ${eta} remaining` }),
      });
    });
    cache.touch(cacheKey);
    cache.evict();
  }

  sendProgress("extract", { percent: 0, status: t("installer.extracting", { progress: "" }).trim() });
  await extract(cachePath, dest, (p) => {
    const elapsed = formatTime(p.elapsedSecs);
    const eta = p.etaSecs >= 0 ? formatTime(p.etaSecs) : "—";
    sendProgress("extract", {
      percent: p.percent,
      status: t("installer.extracting", { progress: `${p.percent}%  ·  ${elapsed} elapsed  ·  ${eta} remaining` }),
    });
  });
}

async function downloadAndExtractMulti(files, dest, cacheDir, { sendProgress, download, cache, extract }) {
  const cacheBase = cache.getCachePath(cacheDir);
  fs.mkdirSync(cacheBase, { recursive: true });

  const count = files.length;
  const totalBytes = files.reduce((sum, f) => sum + (f.size || 0), 0);
  const totalMB = totalBytes > 0 ? (totalBytes / 1048576).toFixed(0) : null;
  let completedBytes = 0;
  let allCached = true;

  for (let i = 0; i < count; i++) {
    const file = files[i];
    const fileCachePath = path.join(cacheBase, file.filename);
    const fileLabel = count > 1 ? ` (${i + 1}/${count})` : "";

    if (fs.existsSync(fileCachePath)) {
      completedBytes += file.size || 0;
      const percent = totalBytes > 0 ? Math.round((completedBytes / totalBytes) * 100) : Math.round(((i + 1) / count) * 100);
      sendProgress("download", { percent, status: `${t("installer.cachedDownload")}${fileLabel}` });
    } else {
      allCached = false;
      const basePercent = totalBytes > 0 ? Math.round((completedBytes / totalBytes) * 100) : Math.round((i / count) * 100);
      sendProgress("download", { percent: basePercent, status: `${t("installer.startingDownload")}${fileLabel}` });
      await download(file.url, fileCachePath, (p) => {
        const speed = `${p.speedMBs.toFixed(1)} MB/s`;
        const elapsed = formatTime(p.elapsedSecs);
        const eta = p.etaSecs >= 0 ? formatTime(p.etaSecs) : "—";
        const receivedTotal = ((completedBytes + p.receivedBytes) / 1048576).toFixed(0);
        const sizeDisplay = totalMB ? `${receivedTotal} / ${totalMB} MB` : `${p.receivedMB} / ${p.totalMB} MB`;
        const percent = totalBytes > 0
          ? Math.round(((completedBytes + p.receivedBytes) / totalBytes) * 100)
          : Math.round((i + p.percent / 100) / count * 100);
        sendProgress("download", {
          percent,
          status: t("installer.downloading", { progress: `${fileLabel} ${sizeDisplay}  ·  ${speed}  ·  ${elapsed} elapsed  ·  ${eta} remaining` }),
        });
      });
      completedBytes += file.size || 0;
    }
  }

  cache.touch(cacheDir);
  if (!allCached) {
    cache.evict();
  }

  // For split archives (.7z.001, .7z.002, …), extract from the first numbered
  // part. For single files or non-split archives, use the file directly.
  const extractFile = files.length === 1
    ? files[0].filename
    : [...files].sort((a, b) => a.filename.localeCompare(b.filename))
        .find((f) => /\.001$/.test(f.filename))?.filename || files[0].filename;
  const extractPath = path.join(cacheBase, extractFile);

  sendProgress("extract", { percent: 0, status: t("installer.extracting", { progress: "" }).trim() });
  await extract(extractPath, dest, (p) => {
    const elapsed = formatTime(p.elapsedSecs);
    const eta = p.etaSecs >= 0 ? formatTime(p.etaSecs) : "—";
    sendProgress("extract", {
      percent: p.percent,
      status: t("installer.extracting", { progress: `${p.percent}%  ·  ${elapsed} elapsed  ·  ${eta} remaining` }),
    });
  });
}

module.exports = { downloadAndExtract, downloadAndExtractMulti };

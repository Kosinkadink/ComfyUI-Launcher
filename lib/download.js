const { net } = require("electron");
const fs = require("fs");
const path = require("path");

/**
 * Download a file with progress reporting.
 * @param {string} url
 * @param {string} destPath - full path to save file
 * @param {(progress: {percent: number, receivedMB: string, totalMB: string}) => void} onProgress
 * @returns {Promise<string>} destPath on success
 */
function download(url, destPath, onProgress, _maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    const request = net.request(url);
    request.setHeader("User-Agent", "ComfyUI-Launcher");

    request.on("response", (response) => {
      // Follow redirects (net.request handles 3xx automatically, but just in case)
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        if (_maxRedirects <= 0) {
          reject(new Error("Download failed: too many redirects"));
          return;
        }
        const loc = Array.isArray(response.headers.location)
          ? response.headers.location[0]
          : response.headers.location;
        download(loc, destPath, onProgress, _maxRedirects - 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${response.statusCode}`));
        return;
      }

      const totalBytes = parseInt(response.headers["content-length"] || "0", 10);
      let receivedBytes = 0;
      const startTime = Date.now();

      const fileStream = fs.createWriteStream(destPath);

      response.on("data", (chunk) => {
        receivedBytes += chunk.length;
        fileStream.write(chunk);
        if (onProgress) {
          const elapsedSecs = (Date.now() - startTime) / 1000;
          const speedMBs = elapsedSecs > 0 ? receivedBytes / 1048576 / elapsedSecs : 0;
          const percent = totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : 0;
          const remainingBytes = totalBytes - receivedBytes;
          const etaSecs = speedMBs > 0 && totalBytes > 0
            ? remainingBytes / 1048576 / speedMBs
            : -1;
          onProgress({
            percent,
            receivedMB: (receivedBytes / 1048576).toFixed(1),
            totalMB: totalBytes > 0 ? (totalBytes / 1048576).toFixed(1) : "?",
            speedMBs,
            elapsedSecs,
            etaSecs,
          });
        }
      });

      response.on("end", () => {
        fileStream.end(() => resolve(destPath));
      });

      response.on("error", (err) => {
        fileStream.close();
        fs.unlinkSync(destPath);
        reject(err);
      });
    });

    request.on("error", reject);
    request.end();
  });
}

module.exports = { download };

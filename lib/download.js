const { net } = require("electron");
const fs = require("fs");
const path = require("path");

/**
 * Download a file with progress reporting.
 * @param {string} url
 * @param {string} destPath - full path to save file
 * @param {(progress: {percent: number, receivedMB: string, totalMB: string}) => void} onProgress
 * @param {{ signal?: AbortSignal, _maxRedirects?: number }} [options]
 * @returns {Promise<string>} destPath on success
 */
function download(url, destPath, onProgress, options = {}) {
  // Support legacy positional _maxRedirects parameter
  if (typeof options === "number") {
    options = { _maxRedirects: options };
  }
  const { signal, _maxRedirects = 5 } = options;

  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(new Error("Download cancelled"));
      return;
    }

    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    const request = net.request(url);
    request.setHeader("User-Agent", "ComfyUI-Launcher");

    let aborted = false;
    const onAbort = () => {
      aborted = true;
      request.abort();
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });

    const cleanup = () => {
      if (signal) signal.removeEventListener("abort", onAbort);
    };

    request.on("response", (response) => {
      // Follow redirects (net.request handles 3xx automatically, but just in case)
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        cleanup();
        if (_maxRedirects <= 0) {
          reject(new Error("Download failed: too many redirects"));
          return;
        }
        const loc = Array.isArray(response.headers.location)
          ? response.headers.location[0]
          : response.headers.location;
        download(loc, destPath, onProgress, { signal, _maxRedirects: _maxRedirects - 1 }).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        cleanup();
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
            receivedBytes,
            receivedMB: (receivedBytes / 1048576).toFixed(1),
            totalMB: totalBytes > 0 ? (totalBytes / 1048576).toFixed(1) : "?",
            speedMBs,
            elapsedSecs,
            etaSecs,
          });
        }
      });

      response.on("end", () => {
        cleanup();
        if (aborted) {
          fileStream.close();
          try { fs.unlinkSync(destPath); } catch {}
          reject(new Error("Download cancelled"));
          return;
        }
        fileStream.end(() => resolve(destPath));
      });

      response.on("error", (err) => {
        cleanup();
        fileStream.close();
        try { fs.unlinkSync(destPath); } catch {}
        if (aborted) {
          reject(new Error("Download cancelled"));
          return;
        }
        reject(err);
      });
    });

    request.on("error", (err) => {
      cleanup();
      if (aborted) {
        reject(new Error("Download cancelled"));
        return;
      }
      reject(err);
    });
    request.end();
  });
}

module.exports = { download };

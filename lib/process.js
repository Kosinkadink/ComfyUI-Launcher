const { spawn, execFile } = require("child_process");
const http = require("http");
const https = require("https");

function spawnProcess(cmd, args, cwd) {
  return spawn(cmd, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  });
}

function killProcessTree(proc) {
  if (!proc || proc.killed) return;
  if (process.platform === "win32") {
    execFile("taskkill", ["/T", "/F", "/PID", String(proc.pid)], { windowsHide: true }, () => {});
  } else {
    try { process.kill(-proc.pid, "SIGKILL"); } catch {}
  }
}

function waitForPort(port, host = "127.0.0.1", { timeoutMs = 60000, intervalMs = 500, onPoll, signal } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let attempt = 0;

    const poll = () => {
      if (signal && signal.aborted) { reject(new Error("Launch cancelled.")); return; }
      const elapsed = Date.now() - start;
      if (elapsed > timeoutMs) {
        reject(new Error(`Timed out waiting for port ${port} after ${Math.round(elapsed / 1000)}s`));
        return;
      }

      attempt++;
      if (onPoll) onPoll({ attempt, elapsedMs: elapsed });

      const req = http.get({ host, port, path: "/", timeout: 2000 }, (res) => {
        res.resume();
        resolve();
      });

      req.on("error", () => setTimeout(poll, intervalMs));
      req.on("timeout", () => {
        req.destroy();
        setTimeout(poll, intervalMs);
      });
    };

    poll();
  });
}

function waitForUrl(url, { timeoutMs = 60000, intervalMs = 500, onPoll, signal } = {}) {
  const client = url.startsWith("https") ? https : http;
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let attempt = 0;

    const poll = () => {
      if (signal && signal.aborted) { reject(new Error("Launch cancelled.")); return; }
      const elapsed = Date.now() - start;
      if (elapsed > timeoutMs) {
        reject(new Error(`Timed out waiting for ${url} after ${Math.round(elapsed / 1000)}s`));
        return;
      }

      attempt++;
      if (onPoll) onPoll({ attempt, elapsedMs: elapsed });

      const req = client.get(url, { timeout: 2000 }, (res) => {
        res.resume();
        resolve();
      });

      req.on("error", () => setTimeout(poll, intervalMs));
      req.on("timeout", () => {
        req.destroy();
        setTimeout(poll, intervalMs);
      });
    };

    poll();
  });
}

module.exports = { spawnProcess, waitForPort, waitForUrl, killProcessTree };

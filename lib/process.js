const { spawn, execFile } = require("child_process");
const http = require("http");
const https = require("https");

function spawnProcess(cmd, args, cwd, env) {
  return spawn(cmd, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
    env: env || process.env,
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

function findPidsByPort(port) {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      execFile("netstat", ["-ano", "-p", "TCP"], { windowsHide: true }, (err, stdout) => {
        if (err) return resolve([]);
        const pids = new Set();
        const target = `:${port}`;
        for (const line of stdout.split("\n")) {
          const parts = line.trim().split(/\s+/);
          // Format: Proto  LocalAddress  ForeignAddress  State  PID
          if (parts.length >= 5 && parts[3] === "LISTENING") {
            const addr = parts[1];
            // Match exactly :port at the end of the address (e.g. 0.0.0.0:8188 or 127.0.0.1:8188)
            if (addr.endsWith(target)) {
              const pid = parseInt(parts[4], 10);
              if (pid > 0) pids.add(pid);
            }
          }
        }
        resolve([...pids]);
      });
    } else {
      execFile("lsof", ["-ti", `:${port}`], { windowsHide: true }, (err, stdout) => {
        if (err) return resolve([]);
        const pids = stdout.trim().split(/\s+/).map((s) => parseInt(s, 10)).filter((n) => n > 0);
        resolve(pids);
      });
    }
  });
}

function killByPort(port) {
  return findPidsByPort(port).then((pids) => {
    if (pids.length === 0) return;
    if (process.platform === "win32") {
      const args = [];
      for (const pid of pids) args.push("/F", "/T", "/PID", String(pid));
      return new Promise((resolve) => {
        execFile("taskkill", args, { windowsHide: true }, () => resolve());
      });
    }
    for (const pid of pids) {
      try { process.kill(pid, "SIGKILL"); } catch {}
    }
  });
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

module.exports = { spawnProcess, waitForPort, waitForUrl, killProcessTree, killByPort };

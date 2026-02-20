const { execFile } = require("child_process");
const path = require("path");

function formatBytes(bytes) {
  if (bytes < 0 || !isFinite(bytes)) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let value = bytes;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${i === 0 ? value : value.toFixed(2)} ${units[i]}`;
}

function getAvailableSpace(dir) {
  if (process.platform === "win32") {
    return getSpaceWindows(dir);
  }
  return getSpacePosix(dir);
}

function getSpaceWindows(dir) {
  const drive = path.parse(path.resolve(dir)).root.replace(/\\$/, "");
  return getSpaceWindowsPowerShell(drive).then((result) => {
    if (result) return result;
    return getSpaceWindowsWmic(drive);
  });
}

function getSpaceWindowsPowerShell(drive) {
  return new Promise((resolve) => {
    execFile(
      "powershell",
      [
        "-NoProfile", "-NonInteractive", "-Command",
        `Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive}'" | Select-Object -Property FreeSpace,Size | ConvertTo-Csv -NoTypeInformation`,
      ],
      { timeout: 10000, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(null);
        try {
          const lines = stdout.trim().split(/\r?\n/).filter((l) => l.trim());
          if (lines.length < 2) return resolve(null);
          const values = lines[1].replace(/"/g, "").split(",");
          const free = parseInt(values[0], 10);
          const total = parseInt(values[1], 10);
          if (isNaN(free) || isNaN(total)) return resolve(null);
          resolve({ free, total });
        } catch {
          resolve(null);
        }
      },
    );
  });
}

function getSpaceWindowsWmic(drive) {
  return new Promise((resolve) => {
    execFile(
      "wmic",
      ["logicaldisk", "where", `DeviceID='${drive}'`, "get", "FreeSpace,Size", "/format:csv"],
      { timeout: 10000, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(null);
        try {
          const lines = stdout.trim().split(/\r?\n/).filter((l) => l.trim());
          const last = lines[lines.length - 1];
          const parts = last.split(",");
          const free = parseInt(parts[1], 10);
          const total = parseInt(parts[2], 10);
          if (isNaN(free) || isNaN(total)) return resolve(null);
          resolve({ free, total });
        } catch {
          resolve(null);
        }
      },
    );
  });
}

function getSpacePosix(dir) {
  // Use -k (1K blocks) for portability — -B1 is GNU-only, unavailable on macOS
  return new Promise((resolve) => {
    execFile(
      "df",
      ["-P", "-k", path.resolve(dir)],
      { timeout: 10000 },
      (err, stdout) => {
        if (err) return resolve(null);
        try {
          const lines = stdout.trim().split(/\r?\n/);
          if (lines.length < 2) return resolve(null);
          const cols = lines[1].split(/\s+/);
          const total = parseInt(cols[1], 10) * 1024;
          const free = parseInt(cols[3], 10) * 1024;
          if (isNaN(free) || isNaN(total)) return resolve(null);
          resolve({ free, total });
        } catch {
          resolve(null);
        }
      },
    );
  });
}

async function hasEnoughSpace(dir, requiredBytes) {
  const space = await getAvailableSpace(dir);
  if (!space) {
    return { ok: true, free: "?", required: formatBytes(requiredBytes) };
  }
  return {
    ok: space.free >= requiredBytes,
    free: formatBytes(space.free),
    required: formatBytes(requiredBytes),
  };
}

module.exports = { getAvailableSpace, formatBytes, hasEnoughSpace };

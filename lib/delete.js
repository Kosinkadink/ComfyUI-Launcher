const fs = require("fs");
const path = require("path");

/**
 * Count entries in a directory, yielding to the event loop periodically.
 */
function countEntries(dir, onBatch) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const batchSize = 500;
    let sinceYield = 0;

    function countDir(d, done) {
      let entries;
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch (err) {
        return done(err);
      }

      let i = 0;
      function next() {
        while (i < entries.length) {
          const entry = entries[i++];
          total++;
          sinceYield++;
          if (entry.isDirectory()) {
            countDir(path.join(d, entry.name), (err) => {
              if (err) return done(err);
              if (sinceYield >= batchSize) {
                sinceYield = 0;
                if (onBatch) onBatch(total);
                setImmediate(next);
                return;
              }
              next();
            });
            return;
          }
          if (sinceYield >= batchSize) {
            sinceYield = 0;
            if (onBatch) onBatch(total);
            setImmediate(next);
            return;
          }
        }
        done(null);
      }
      next();
    }

    countDir(dir, (err) => {
      if (err) return reject(err);
      resolve(total);
    });
  });
}

/**
 * Recursively delete a directory with progress reporting.
 * @param {string} dir
 * @param {(p: {deleted: number, total: number, percent: number}) => void} [onProgress]
 */
async function deleteDir(dir, onProgress) {
  if (!fs.existsSync(dir)) return;

  const total = await countEntries(dir, (counted) => {
    if (onProgress) onProgress({ deleted: 0, total: counted, percent: 0 });
  });

  let deleted = 0;
  const batchSize = 200;
  let sinceYield = 0;

  await new Promise((resolve, reject) => {
    function walkAsync(d, done) {
      let entries;
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch (err) {
        return done(err);
      }

      let i = 0;
      function next() {
        while (i < entries.length) {
          const entry = entries[i++];
          const fullPath = path.join(d, entry.name);
          if (entry.isDirectory()) {
            walkAsync(fullPath, (err) => {
              if (err) return done(err);
              try { fs.rmdirSync(fullPath); } catch (e) { return done(e); }
              deleted++;
              if (onProgress) {
                onProgress({ deleted, total, percent: Math.round((deleted / total) * 100) });
              }
              sinceYield++;
              if (sinceYield >= batchSize) {
                sinceYield = 0;
                setImmediate(next);
                return;
              }
              next();
            });
            return;
          } else {
            try { fs.unlinkSync(fullPath); } catch (e) { return done(e); }
            deleted++;
            if (onProgress) {
              onProgress({ deleted, total, percent: Math.round((deleted / total) * 100) });
            }
            sinceYield++;
            if (sinceYield >= batchSize) {
              sinceYield = 0;
              setImmediate(next);
              return;
            }
          }
        }
        done(null);
      }
      next();
    }

    walkAsync(dir, (err) => {
      if (err) return reject(err);
      try {
        fs.rmdirSync(dir);
      } catch (e) {
        return reject(e);
      }
      resolve();
    });
  });
}

module.exports = { deleteDir };

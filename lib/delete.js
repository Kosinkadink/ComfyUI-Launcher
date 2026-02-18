const fs = require("fs");
const path = require("path");

/**
 * Count entries in a directory, yielding to the event loop periodically.
 */
function countEntries(dir, onBatch, signal) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const batchSize = 500;
    let sinceYield = 0;

    function countDir(d, done) {
      if (signal && signal.aborted) return done(new Error("Delete cancelled"));
      fs.readdir(d, { withFileTypes: true }, (err, entries) => {
        if (err) return done(err);

        let i = 0;
        function next() {
          if (signal && signal.aborted) return done(new Error("Delete cancelled"));
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
      });
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
 * @param {(p: {deleted: number, total: number, percent: number, elapsedSecs: number}) => void} [onProgress]
 * @param {{ signal?: AbortSignal }} [options]
 */
async function deleteDir(dir, onProgress, options = {}) {
  const { signal } = options;
  if (!fs.existsSync(dir)) return;
  if (signal && signal.aborted) throw new Error("Delete cancelled");

  const total = await countEntries(dir, (counted) => {
    if (onProgress) onProgress({ deleted: 0, total: counted, percent: 0, elapsedSecs: 0 });
  }, signal);

  let deleted = 0;
  const batchSize = 200;
  let sinceYield = 0;
  const startTime = Date.now();

  const report = () => {
    if (onProgress) {
      const elapsedSecs = (Date.now() - startTime) / 1000;
      const etaSecs = deleted > 0 ? elapsedSecs * ((total - deleted) / deleted) : -1;
      onProgress({ deleted, total, percent: total > 0 ? Math.round((deleted / total) * 100) : 100, elapsedSecs, etaSecs });
    }
  };

  await new Promise((resolve, reject) => {
    function walkAsync(d, done) {
      if (signal && signal.aborted) return done(new Error("Delete cancelled"));
      fs.readdir(d, { withFileTypes: true }, (err, entries) => {
        if (err) return done(err);

        let i = 0;
        function next() {
          if (signal && signal.aborted) return done(new Error("Delete cancelled"));
          if (i >= entries.length) return done(null);
          const entry = entries[i++];
          const fullPath = path.join(d, entry.name);
          if (entry.isDirectory()) {
            walkAsync(fullPath, (err) => {
              if (err) return done(err);
              fs.rmdir(fullPath, (e) => {
                if (e) return done(e);
                deleted++;
                report();
                sinceYield++;
                if (sinceYield >= batchSize) {
                  sinceYield = 0;
                  setImmediate(next);
                } else {
                  next();
                }
              });
            });
          } else {
            fs.unlink(fullPath, (e) => {
              if (e) return done(e);
              deleted++;
              report();
              sinceYield++;
              if (sinceYield >= batchSize) {
                sinceYield = 0;
                setImmediate(next);
              } else {
                next();
              }
            });
          }
        }
        next();
      });
    }

    walkAsync(dir, (err) => {
      if (err) return reject(err);
      fs.rmdir(dir, (e) => {
        if (e) return reject(e);
        resolve();
      });
    });
  });
}

module.exports = { deleteDir };

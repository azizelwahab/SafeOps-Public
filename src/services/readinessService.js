import { getDatabase } from '../config/database.js';

export function createReadinessCheck(probeDatabase = () => getDatabase().$queryRaw`SELECT 1`) {
  let activeProbe;

  return async function checkDatabaseReadiness() {
    // Concurrent callers share a probe so outages do not create a queue of duplicate checks.
    activeProbe ??= Promise.resolve()
      .then(probeDatabase)
      .finally(() => { activeProbe = undefined; });

    let deadline;
    try {
      await Promise.race([
        activeProbe,
        new Promise((_, reject) => {
          deadline = setTimeout(() => reject(new Error('Readiness check timed out')), 2000);
        }),
      ]);
    } finally {
      clearTimeout(deadline);
    }
  };
}

export function createShutdown(server, disconnect, { timeoutMs = 10_000, exit = process.exit } = {}) {
  let shuttingDown = false;

  return function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`Received ${signal}. Shutting down the HTTP server.`);

    // The deadline covers both HTTP draining and Prisma disconnection.
    const deadline = setTimeout(() => {
      console.error(`Shutdown exceeded ${timeoutMs} ms. Closing remaining connections.`);
      server.closeAllConnections();
      exit(1);
    }, timeoutMs);

    server.close(async (error) => {
      if (error) {
        console.error('HTTP shutdown failed:', error);
        process.exitCode = 1;
      }
      try {
        await disconnect();
      } catch {
        console.error('Database shutdown failed.');
        process.exitCode = 1;
      } finally {
        clearTimeout(deadline);
      }
    });
  };
}

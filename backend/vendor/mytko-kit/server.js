// Runs an app's HTTP server: listens, probes the database once (informational; /readyz reports actual readiness),
// and shuts down cleanly on SIGTERM/SIGINT (stops accepting connections, waits for requests in flight up to
// shutdownTimeoutMs, ends the pool). An unhandled rejection is logged without its details and stops the process (the
// container restarts the app).
//
// instance: what the app's createApp returned ({ app, markShuttingDown(), stop() }).
function runServer({ config, pool, instance }) {
  const { app, markShuttingDown, stop } = instance;
  const server = app.listen(config.port, config.host, () => {
    console.log(`Server listening on ${config.host}:${config.port}`);
  });

  pool.query("SELECT 1").then(
    () => console.log("Database reachable"),
    () => console.error("Database not reachable yet:", "database operation failed")
  );

  let shuttingDown = false;

  function shutdown(signal, failed = false) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, shutting down`);

    markShuttingDown();

    const forceExit = setTimeout(() => {
      console.error("Shutdown timed out, forcing exit");
      process.exit(1);
    }, config.shutdownTimeoutMs);
    forceExit.unref();

    // Stops accepting connections and waits for in-flight requests.
    server.close(async (error) => {
      if (error) console.error("HTTP server close error:", "operation failed");
      stop();
      try {
        await pool.end();
      } catch {
        console.error("Pool close error:", "operation failed");
      }
      process.exit(error || failed ? 1 : 0);
    });
    server.closeIdleConnections();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("unhandledRejection", () => {
    console.error("Unhandled rejection");
    shutdown("unhandledRejection", true);
  });
  return server;
}

module.exports = { runServer };

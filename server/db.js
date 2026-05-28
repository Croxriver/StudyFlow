const sql = require("mssql");

let poolPromise;

function getSqlConfig() {
  const required = ["SQL_SERVER", "SQL_DATABASE", "SQL_USER", "SQL_PASSWORD"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length) {
    throw new Error(`Missing SQL environment variables: ${missing.join(", ")}`);
  }

  const { server, port } = parseServerAddress(process.env.SQL_SERVER);

  return {
    server,
    database: process.env.SQL_DATABASE,
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    port: Number(process.env.SQL_PORT || port || 1433),
    options: {
      encrypt: process.env.SQL_ENCRYPT !== "false",
      trustServerCertificate: process.env.SQL_TRUST_SERVER_CERTIFICATE === "true"
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000
    }
  };
}

function parseServerAddress(value) {
  const server = String(value || "").trim();
  const commaPortMatch = server.match(/^(.+),(\d+)$/);

  if (commaPortMatch) {
    return {
      server: commaPortMatch[1],
      port: Number(commaPortMatch[2])
    };
  }

  return { server };
}

async function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect(getSqlConfig())
      .then((pool) => {
        pool.on("error", () => {
          poolPromise = null;
        });
        return pool;
      })
      .catch((error) => {
        poolPromise = null;
        throw error;
      });
  }

  return poolPromise;
}

async function resetPool() {
  const currentPool = await poolPromise.catch(() => null);
  poolPromise = null;
  if (currentPool) {
    await currentPool.close().catch(() => {});
  }
}

module.exports = {
  sql,
  getPool,
  resetPool
};

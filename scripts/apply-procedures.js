const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { getPool } = require("../server/db");

async function main() {
  const filePath = path.join(__dirname, "..", "db", "procedures.sql");
  const script = fs.readFileSync(filePath, "utf8");
  const batches = script
    .split(/^\s*GO\s*;?\s*$/gim)
    .map((batch) => batch.trim())
    .filter(Boolean);
  const pool = await getPool();

  for (const batch of batches) {
    await pool.request().batch(batch);
  }

  console.log(`Applied ${batches.length} procedure batches.`);
  await pool.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

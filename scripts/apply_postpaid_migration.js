const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const pool = require("../src/config/database");

async function main() {
  const sqlPath = path.join(
    __dirname,
    "../migrations/20261117_postpaid_wallet.sql",
  );
  const sql = fs.readFileSync(sqlPath, "utf8");

  const client = await pool.connect();
  try {
    console.log("Applying migration 20261117_postpaid_wallet.sql...");
    await client.query(sql);

    const checkRes = await client.query(
      `
      SELECT
        to_regclass('public.postpaid_wallets')::text AS postpaid_wallets_table,
        to_regclass('public.postpaid_entries')::text AS postpaid_entries_table,
        (SELECT balance FROM users WHERE id = $1::uuid) AS system_postpaid_balance,
        (SELECT value FROM system_configs WHERE key = 'POSTPAID_CONFIG') AS postpaid_config,
        (SELECT value FROM system_configs WHERE key = 'POSTPAID_STATUS') AS postpaid_status,
        (SELECT value FROM system_configs WHERE key = 'POSTPAID_ENTRY_ACTIONS') AS postpaid_entry_actions
    `,
      [process.env.SYSTEM_POSTPAID_WALLET_ID],
    );
    console.log("Verified postpaid objects:", checkRes.rows[0]);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});


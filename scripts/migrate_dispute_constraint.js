const pool = require("../src/config/database");

async function runMigration() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    console.log("Dropping old constraint chk_admin_change_action...");
    await client.query(
      "ALTER TABLE admin_user_change_history DROP CONSTRAINT IF EXISTS chk_admin_change_action"
    );

    console.log("Adding updated constraint with DISPUTE actions...");
    await client.query(`
      ALTER TABLE admin_user_change_history
      ADD CONSTRAINT chk_admin_change_action
      CHECK ((action)::text = ANY (ARRAY[
        'USER_PROFILE_UPDATED'::text,
        'USER_BLOCKED'::text,
        'USER_UNBLOCKED'::text,
        'USER_LOGIN_UNLOCKED'::text,
        'USER_SESSIONS_REVOKED'::text,
        'USER_QR_REGENERATED'::text,
        'ADMIN_OP_P2P'::text,
        'ADMIN_OP_TOPUP'::text,
        'ADMIN_OP_WITHDRAW'::text,
        'DISPUTE_OPENED'::text,
        'DISPUTE_UPDATED'::text,
        'DISPUTE_RESOLVED'::text
      ]))
    `);

    await client.query("COMMIT");
    console.log("Migration SUCCESS!");

    const res = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) as def
      FROM pg_constraint
      WHERE conname = 'chk_admin_change_action'
    `);
    console.table(res.rows);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Migration FAILED:", e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();


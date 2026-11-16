const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('pg');
const dotenv = require('dotenv');

function assertTestTarget(name, protectedNames, mode) {
  if (mode !== 'test' || typeof name !== 'string' || !/^merchant_test_[a-z0-9_]{1,40}$/.test(name)
      || protectedNames.some(protectedName => protectedName?.toLowerCase() === name.toLowerCase())) {
    throw new Error('Refusing database writes: target must be a new merchant_test_* database, distinct from production');
  }
}

async function createTestDatabase() {
  // Read connection coordinates only; never load production signing secrets.
  const source = dotenv.parse(fs.readFileSync(path.join(__dirname, '../.env')));
  const name = process.env.MERCHANT_TEST_DATABASE || `merchant_test_${process.pid}_${crypto.randomBytes(5).toString('hex')}`;
  const protectedNames = [source.DB_NAME, process.env.DB_NAME, 'postgres', 'template0', 'template1'];
  assertTestTarget(name, protectedNames, process.env.NODE_ENV);
  const config = {
    host: source.DB_HOST, port: source.DB_PORT, user: source.DB_USER,
    password: source.DB_PASSWORD, connectionTimeoutMillis: 7000, statement_timeout: 10000,
  };
  // CREATE DATABASE uses the maintenance DB, never the application DB.
  const maintenance = new Client({ ...config, database: 'postgres' });
  let created = false;
  await maintenance.connect();
  async function cleanup() {
    try {
      if (created) {
        assertTestTarget(name, protectedNames, process.env.NODE_ENV);
        await maintenance.query(`DROP DATABASE "${name}"`);
        created = false;
        const result = await maintenance.query('SELECT 1 FROM pg_database WHERE datname=$1', [name]);
        if (result.rowCount !== 0) throw new Error('Test database cleanup failed');
      }
    } finally {
      await maintenance.end();
    }
  }
  try {
    // No IF EXISTS or reuse: a pre-existing database must never be altered/dropped.
    await maintenance.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    created = true;
    await maintenance.query(`ALTER DATABASE "${name}" SET timezone TO 'Asia/Ho_Chi_Minh'`);
    const setup = new Client({ ...config, database: name });
    try {
      await setup.connect();
      const identity = await setup.query('SELECT current_database() AS db');
      if (identity.rows[0].db !== name) throw new Error('Unexpected test database');
      await setup.query(fs.readFileSync(path.join(__dirname, 'merchant_test_schema.sql'), 'utf8'));
    } finally {
      await setup.end();
    }
    Object.assign(process.env, { DB_HOST: source.DB_HOST, DB_PORT: String(source.DB_PORT || 5432),
      DB_USER: source.DB_USER, DB_PASSWORD: source.DB_PASSWORD, DB_NAME: name,
      ACCESS_SECRET: crypto.randomBytes(32).toString('hex'),
      REFRESH_SECRET: crypto.randomBytes(32).toString('hex'), DOTENV_CONFIG_QUIET: 'true' });
    return { name, config: { ...config, database: name }, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

module.exports = { assertTestTarget, createTestDatabase };

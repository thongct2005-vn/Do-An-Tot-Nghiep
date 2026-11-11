const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const path = require("node:path");

// Opt-in: MERCHANT_STATUS_SQL_TEST=1 node --test tests/admin_merchants_status.test.js
// The real repository SQL runs against query-local fixtures. READ ONLY plus a
// pg_catalog-only search_path prevents writes and access to application tables.
describe("Admin Merchant 1.1A — account status independent of KYC", {
  skip: process.env.MERCHANT_STATUS_SQL_TEST !== "1",
}, () => {
  let client;
  let repository;
  let server;
  let baseUrl;
  const savedModules = new Map();
  const users = [];
  const kycs = [];
  const expected = new Map();
  const date = "2026-01-01T00:00:00";

  function addMerchant(status, kycStatus, operational, api = "LINKED", extra = {}) {
    const id = `00000000-0000-4000-8000-${String(users.length + 1).padStart(12, "0")}`;
    users.push({
      id, role: "MERCHANT", full_name: `Fixture ${users.length + 1}`,
      phone: "0900000000", email: "fixture@example.test", balance: 0,
      status, api_key: "fixture-api-key", secret_key: "fixture-secret",
      call_back_url: "https://example.test/callback", totp_enabled: false,
      created_at: date, updated_at: date, ...extra,
    });
    if (kycStatus !== undefined) {
      kycs.push({ id: `kyc-${id}`, user_id: id, status: kycStatus,
        created_at: date, updated_at: date });
    }
    expected.set(id, {
      operational_status: operational, api_status: api,
      approval_status: kycStatus === "APPPROVED" ? "APPROVED" : kycStatus ?? "PENDING",
    });
    return id;
  }

  for (const [status, operational, api] of [
    ["ACTIVE", "ACTIVE", "LINKED"],
    ["BLOCKED", "SUSPENDED", "LOCKED"],
    ["SUSPENDED", "SUSPENDED", "LOCKED"],
    [null, "UNKNOWN", "NOT_CONNECTED"],
    ["OTHER", "UNKNOWN", "NOT_CONNECTED"],
  ]) {
    for (const kyc of ["APPROVED", "APPPROVED", "PENDING", "REJECTED", undefined]) {
      addMerchant(status, kyc, operational, api);
    }
  }
  addMerchant("ACTIVE", "REJECTED", "ACTIVE", "PENDING_KEY", { api_key: null });
  addMerchant("ACTIVE", "PENDING", "ACTIVE", "PENDING_KEY", { secret_key: null });
  addMerchant("BLOCKED", "PENDING", "SUSPENDED", "LOCKED", { api_key: null, secret_key: null });
  const latestKycId = addMerchant("ACTIVE", "APPROVED", "ACTIVE");
  kycs.push({ id: "newer-kyc", user_id: latestKycId, status: "REJECTED",
    created_at: date, updated_at: "2026-02-01T00:00:00" });
  expected.get(latestKycId).approval_status = "REJECTED";
  const missingCallbacks = [null, "", "   "].map((call_back_url) =>
    addMerchant("ACTIVE", "APPROVED", "ACTIVE", "NOT_CONNECTED", { call_back_url }));

  function statuses(row) {
    return Object.fromEntries(["operational_status", "api_status", "approval_status"]
      .map((key) => [key, row[key]]));
  }

  async function fixtureQuery(sql, params = []) {
    if (sql.includes("FROM users u")) {
      const u = params.length + 1;
      const k = params.length + 2;
      return client.query(`WITH
        users AS (SELECT * FROM jsonb_to_recordset($${u}::jsonb) AS x(
          id uuid, role text, full_name text, email text, phone text, balance bigint,
          status text, api_key text, secret_key text, call_back_url text,
          totp_enabled boolean, failed_login_attempts integer, locked_until timestamp,
          created_at timestamp, updated_at timestamp)),
        user_kyc AS (SELECT * FROM jsonb_to_recordset($${k}::jsonb) AS x(
          id text, user_id uuid, status text, dob date, gender text, address text,
          front_image_url text, back_image_url text, face_image_url text,
          face_match_score numeric, created_at timestamp, updated_at timestamp)),
        linked_bank_accounts AS (SELECT NULL::uuid AS user_id,
          NULL::text AS account_holder_name, false AS is_default,
          NULL::timestamp AS created_at WHERE false)
        ${sql}`, [...params, JSON.stringify(users), JSON.stringify(kycs)]);
    }
    // Unrelated detail sections are stubbed; status SQL above uses PostgreSQL.
    if (/FROM (linked_bank_accounts|admin_user_change_history|payment_requests|transactions)\b/.test(sql)) {
      return { rows: [] };
    }
    throw new Error("Unexpected repository query in status test");
  }

  before(async () => {
    require("dotenv").config({ path: path.join(__dirname, "../.env"), quiet: true });
    const { Client } = require("pg");
    client = new Client({ host: process.env.DB_HOST, port: process.env.DB_PORT,
      database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
      connectionTimeoutMillis: 7000, statement_timeout: 7000 });
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL search_path TO pg_catalog");

    for (const name of ["../src/config/database", "../src/admin/merchants/merchants.repository",
      "../src/admin/merchants/merchants.service", "../src/admin/merchants/merchants.controller"]) {
      const resolved = require.resolve(name);
      savedModules.set(resolved, require.cache[resolved]);
      delete require.cache[resolved];
    }
    const databasePath = require.resolve("../src/config/database");
    require.cache[databasePath] = { id: databasePath, filename: databasePath,
      loaded: true, exports: { query: fixtureQuery, connect: async () => ({
        // CTE fixture rows are immutable; real snapshot/concurrency is tested in group D.
        query: (sql, params) => /^(BEGIN|COMMIT|ROLLBACK)/.test(sql)
          ? Promise.resolve({ rows: [] }) : fixtureQuery(sql, params),
        release() {},
      }) } };
    repository = require("../src/admin/merchants/merchants.repository");
    const controller = require("../src/admin/merchants/merchants.controller");

    // Isolated HTTP controller/service/repository tests. Real auth/session E2E is group D.
    const app = require("express")();
    app.get("/api/v2/admin/merchants", controller.getMerchants);
    app.get("/api/v2/admin/merchants/:id", controller.getMerchantDetail);
    app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ message: error.message }));
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    baseUrl = `http://127.0.0.1:${server.address().port}/api/v2/admin/merchants`;
  });

  after(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    for (const [name, saved] of savedModules) {
      if (saved) require.cache[name] = saved;
      else delete require.cache[name];
    }
    if (client) {
      try { await client.query("ROLLBACK"); } finally { await client.end(); }
    }
  });

  it("evaluates account/KYC matrix and missing key cases using repository SQL", async () => {
    const result = await repository.getMerchants({ limit: 100 });
    assert.equal(result.total, users.length);
    assert.equal(result.items.length, users.length);
    for (const row of result.items) assert.deepEqual(statuses(row), expected.get(row.id), row.id);
  });

  it("keeps missing KYC merchants and selects one latest KYC without duplicate rows", async () => {
    const result = await repository.getMerchants({ limit: 100 });
    assert.equal(new Set(result.items.map((row) => row.id)).size, users.length);
    assert.equal(result.items.find((row) => row.id === latestKycId).approval_status, "REJECTED");
    const missingKyc = users.filter((row) => !kycs.some((kyc) => kyc.user_id === row.id));
    assert.equal(missingKyc.length, 5);
    for (const user of missingKyc) {
      assert.equal(result.items.find((row) => row.id === user.id).approval_status, "PENDING");
    }
  });

  it("list and detail GET responses agree, including nested status fields", async () => {
    const response = await fetch(`${baseUrl}?limit=100`);
    assert.equal(response.status, 200);
    const { data: list } = await response.json();
    assert.equal(list.items.length, users.length);
    for (const row of list.items) {
      const response = await fetch(`${baseUrl}/${row.id}`);
      assert.equal(response.status, 200);
      const { data: detail } = await response.json();
      assert.deepEqual(statuses(detail), expected.get(row.id));
      assert.deepEqual(statuses(detail), statuses(row));
      assert.equal(detail.integration.api_status, row.api_status);
      assert.equal(detail.review_decision.operational_status, row.operational_status);
      assert.equal(detail.review_decision.approval_status, row.approval_status);
    }
  });

  it("uses the same configured rule in KPI, tabs and API status", async () => {
    const stats = await repository.getMerchantStats();
    assert.deepEqual(stats, { total_merchants: 32, linked_merchants: 6,
      pending_merchants: 12, unconfigured_merchants: 5, suspended_merchants: 11 });
    for (const [tab, field] of [["LINKED", "linked_merchants"],
      ["UNCONFIGURED", "unconfigured_merchants"], ["PENDING", "pending_merchants"],
      ["SUSPENDED", "suspended_merchants"]]) {
      const response = await fetch(`${baseUrl}?tab=${tab}&limit=100`);
      assert.equal(response.status, 200);
      const { data } = await response.json();
      assert.deepEqual(data.stats, stats);
      assert.equal(data.pagination.total_items, stats[field]);
      assert.equal(data.items.length, stats[field]);
      for (const id of missingCallbacks) {
        if (["LINKED", "UNCONFIGURED"].includes(tab)) {
          assert.equal(data.items.some((row) => row.id === id), tab === "UNCONFIGURED");
        }
      }
    }
    const pendingLocked = await repository.getMerchants({ tab: "PENDING", status: "SUSPENDED" });
    assert.equal(pendingLocked.total, 5);
  });
});

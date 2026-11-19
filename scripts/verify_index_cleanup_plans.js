const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const pool = require("../src/config/database");

const CLASSIFICATION = {
  group1_exact_duplicate: [
    { table: "users", name: "uk_users_phone", kind: "UNIQUE CONSTRAINT", keptEquivalent: "users_phone_key" },
    { table: "payment_request_items", name: "idx_payment_request_items_pr_id", kind: "INDEX", keptEquivalent: "idx_pri_payment_request" },
    { table: "payment_requests", name: "idx_payment_requests_reference_code", kind: "INDEX", keptEquivalent: "payment_requests_reference_code_key" },
  ],
  group2_covered: [
    { table: "payment_requests", name: "idx_payment_requests_transaction_id", kind: "INDEX", keptEquivalent: "idx_pr_transaction_id_inc" },
    { table: "payment_requests", name: "idx_payment_requests_destination_user", kind: "INDEX", keptEquivalent: "idx_pr_dest_created_inc" },
    { table: "transactions", name: "idx_transactions_dest_payment", kind: "INDEX", keptEquivalent: "idx_transactions_dest_time / idx_transactions_merchant_success_created" },
  ],
  group3_low_scan_or_special_value: [
    { table: "transactions", name: "idx_transactions_source_time", decision: "KEEP", reason: "305 MB < 443 MB idx_transactions_source_created_id; efficient under shared_buffers=128MB" },
    { table: "transactions", name: "idx_transactions_dest_time", decision: "KEEP", reason: "254 MB < 665 MB idx_transactions_dest_created_id_inc; actively scanned 2,345 times" },
    { table: "payment_request_items", name: "idx_pri_product", decision: "KEEP", reason: "Supports merchant product-stats queries" },
    { table: "transactions", name: "idx_transactions_type_status", decision: "KEEP", reason: "Supports admin transaction_type + status filtering without date range" },
    { table: "audit_outbox", name: "idx_audit_outbox_pending", decision: "KEEP", reason: "32 kB; designed for future outbox worker polling" },
    { table: "audit_outbox", name: "idx_audit_outbox_tx_id", decision: "KEEP", reason: "Partial expression index protecting getTransactionTimeline long-term" },
  ],
};

function statsMs(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return {
    p50: Number(s[Math.floor((s.length - 1) * 0.5)].toFixed(3)),
    p95: Number(s[Math.floor((s.length - 1) * 0.95)].toFixed(3)),
    max: Number(s[s.length - 1].toFixed(3)),
  };
}

async function explainAndBench(db, label, sql, params, runs = 5) {
  const times = [];
  let plan = null;
  for (let i = 0; i < runs; i += 1) {
    const t0 = performance.now();
    const res = await db.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params);
    const t1 = performance.now();
    times.push(t1 - t0);
    if (i === runs - 1) {
      plan = res.rows[0]["QUERY PLAN"][0];
    }
  }
  const collectNodes = (n, out = []) => {
    out.push({
      node: n["Node Type"],
      relation: n["Relation Name"] || null,
      index: n["Index Name"] || null,
      actualMs: n["Actual Total Time"],
      rows: n["Actual Rows"],
    });
    for (const c of n.Plans || []) collectNodes(c, out);
    return out;
  };
  return {
    label,
    timing: statsMs(times),
    executionTimeMs: plan["Execution Time"],
    nodes: collectNodes(plan.Plan),
  };
}

async function main() {
  const client = await pool.connect();
  try {
    // 1) Verify audit_outbox data integrity & index state (Task 2.2)
    const auditCheck = await client.query(`
      SELECT
        COUNT(*)::int AS total_rows,
        COUNT(*) FILTER (WHERE published_at IS NULL)::int AS unpublished_rows
      FROM public.audit_outbox
    `);

    const aoSample = await client.query(`
      SELECT payload->>'transaction_id' AS tx_id
      FROM public.audit_outbox
      WHERE payload->>'transaction_id' IS NOT NULL
      LIMIT 1
    `);
    const sampleAoTx = aoSample.rows[0]?.tx_id || "1000001";

    const aoDefaultPlan = await explainAndBench(
      client,
      "audit_outbox_timeline_default_planner",
      `SELECT id, event_type, payload, created_at FROM public.audit_outbox WHERE (payload->>'transaction_id') = $1::TEXT`,
      [sampleAoTx]
    );

    await client.query("BEGIN");
    await client.query("SET LOCAL enable_seqscan = off");
    const aoIdxRes = await client.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id, event_type, payload, created_at FROM public.audit_outbox WHERE (payload->>'transaction_id') = $1::TEXT`,
      [sampleAoTx]
    );
    await client.query("ROLLBACK");

    // 2) Size & dependency checks for Group 1 & Group 2
    const targetNames = [
      ...CLASSIFICATION.group1_exact_duplicate.map((x) => x.name),
      ...CLASSIFICATION.group2_covered.map((x) => x.name),
    ];

    const idxSizes = await client.query(
      `
      SELECT
        c.relname AS name,
        c.relkind,
        pg_relation_size(c.oid)::bigint AS bytes,
        pg_size_pretty(pg_relation_size(c.oid)) AS size_pretty,
        COALESCE(s.idx_scan, 0)::bigint AS idx_scan,
        i.indisvalid
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_index i ON i.indexrelid = c.oid
      LEFT JOIN pg_stat_user_indexes s ON s.indexrelid = c.oid
      WHERE n.nspname = 'public'
        AND c.relname = ANY($1::text[])
      ORDER BY pg_relation_size(c.oid) DESC
      `,
      [targetNames]
    );

    const fkDeps = await client.query(
      `
      SELECT
        con.conname,
        con.contype,
        rel.relname AS on_table,
        pg_get_constraintdef(con.oid) AS def
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      WHERE con.contype = 'f'
        AND (
          con.conindid IN (SELECT oid FROM pg_class WHERE relname = ANY($1::text[]))
          OR con.confrelid = 'public.users'::regclass
        )
      ORDER BY rel.relname, con.conname
      `,
      [targetNames]
    );

    const ukDep = await client.query(`
      SELECT c.conname, c.contype, c.conindid::regclass::text AS backing_idx,
             EXISTS (
               SELECT 1 FROM pg_depend d
               WHERE d.refobjid = c.oid AND d.deptype IN ('n', 'a')
             ) AS has_dependents_on_con
      FROM pg_constraint c
      WHERE c.conrelid = 'public.users'::regclass AND c.conname = 'uk_users_phone'
    `);

    // 3) Sample real IDs for EXPLAIN benchmarks
    const samples = await client.query(`
      SELECT
        (SELECT phone FROM public.users LIMIT 1) AS sample_phone,
        (SELECT id FROM public.users WHERE role = 'MERCHANT' LIMIT 1) AS sample_merchant_id,
        (SELECT id FROM public.users WHERE role = 'USER' LIMIT 1) AS sample_user_id,
        (SELECT id FROM public.payment_requests WHERE transaction_id IS NOT NULL LIMIT 1) AS sample_pr_id,
        (SELECT reference_code FROM public.payment_requests LIMIT 1) AS sample_ref_code,
        (SELECT transaction_id FROM public.payment_requests WHERE transaction_id IS NOT NULL LIMIT 1) AS sample_pr_tx_id
    `);
    const s = samples.rows[0];

    const benchmarks = [];
    benchmarks.push(
      await explainAndBench(
        client,
        "users_by_phone",
        `SELECT id, role, status FROM public.users WHERE phone = $1`,
        [s.sample_phone]
      )
    );
    benchmarks.push(
      await explainAndBench(
        client,
        "pri_by_payment_request_id",
        `SELECT id, product_id, quantity, unit_price FROM public.payment_request_items WHERE payment_request_id = $1`,
        [s.sample_pr_id]
      )
    );
    benchmarks.push(
      await explainAndBench(
        client,
        "pr_by_reference_code",
        `SELECT id, status, amount, transaction_id FROM public.payment_requests WHERE reference_code = $1`,
        [s.sample_ref_code]
      )
    );
    benchmarks.push(
      await explainAndBench(
        client,
        "pr_by_transaction_id",
        `SELECT id, reference_code, order_id, amount, status FROM public.payment_requests WHERE transaction_id = $1`,
        [s.sample_pr_tx_id]
      )
    );
    benchmarks.push(
      await explainAndBench(
        client,
        "pr_by_dest_user_recent",
        `SELECT id, status, reference_code FROM public.payment_requests WHERE destination_user_id = $1 ORDER BY created_at DESC LIMIT 20`,
        [s.sample_merchant_id]
      )
    );
    benchmarks.push(
      await explainAndBench(
        client,
        "tx_source_history_recent",
        `SELECT id, transaction_type, amount, status, created_at FROM public.transactions WHERE source_user_id = $1 ORDER BY created_at DESC LIMIT 20`,
        [s.sample_user_id]
      )
    );
    benchmarks.push(
      await explainAndBench(
        client,
        "tx_dest_payment_history",
        `SELECT id, amount, status, created_at FROM public.transactions WHERE destination_user_id = $1 AND transaction_type = 'PAYMENT' ORDER BY created_at DESC LIMIT 20`,
        [s.sample_merchant_id]
      )
    );

    const totalDropBytes = idxSizes.rows.reduce((sum, r) => sum + Number(r.bytes || 0), 0);
    const report = {
      capturedAt: new Date().toISOString(),
      auditOutboxCheck: {
        ...auditCheck.rows[0],
        defaultPlannerPlan: aoDefaultPlan,
        forcedIndexPlanNodes: aoIdxRes.rows[0]["QUERY PLAN"][0].Plan,
      },
      classification: CLASSIFICATION,
      group1And2Sizes: idxSizes.rows,
      estimatedDropMB: Number((totalDropBytes / (1024 * 1024)).toFixed(2)),
      ukUsersPhoneConstraint: ukDep.rows[0],
      foreignKeyRefsOnDroppedOrUsers: fkDeps.rows,
      explainBenchmarks: benchmarks,
    };

    const outPath =
      "C:/Users/Admin/.gemini/antigravity/brain/176b17c8-0c8d-46e3-bb08-6af740b8f18b/scratch/phase2_index_verification_report.json";
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

    console.log("audit_outbox:", auditCheck.rows[0]);
    console.log("ao default nodes:", aoDefaultPlan.nodes);
    console.log("ao forced index node:", aoIdxRes.rows[0]["QUERY PLAN"][0].Plan["Node Type"], aoIdxRes.rows[0]["QUERY PLAN"][0].Plan["Index Name"]);
    console.table(idxSizes.rows.map((r) => ({ name: r.name, size: r.size_pretty, idx_scan: r.idx_scan, indisvalid: r.indisvalid })));
    console.log("Estimated Group 1+2 savings (MB):", report.estimatedDropMB);
    console.log("uk_users_phone dep check:", ukDep.rows[0]);
    console.table(
      benchmarks.map((b) => ({
        label: b.label,
        p50_ms: b.timing.p50,
        p95_ms: b.timing.p95,
        exec_ms: b.executionTimeMs,
        indexes: b.nodes.map((n) => `${n.node}${n.index ? `(${n.index})` : ""}`).join(" -> "),
      }))
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

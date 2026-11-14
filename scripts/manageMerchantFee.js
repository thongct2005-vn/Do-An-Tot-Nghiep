#!/usr/bin/env node
require("dotenv/config");

const readline = require("node:readline");
const { Writable } = require("node:stream");
const pool = require("../src/config/database");
const adminAuthService = require("../src/admin/auth/auth.service");
const adminMerchantFeeService = require("../src/admin/merchants/merchantFee.service");

function printHelp() {
  console.log(`
Usage:
  node scripts/manageMerchantFee.js [action & options]

Authentication (required; NEVER hardcode credentials in scripts):
  Set env ADMIN_EMAIL / ADMIN_PASSWORD, or pass --admin-email and enter password interactively.
  Optional --actor <operator-name> (saved in audit log as "cli:<operator-name>").

Actions:
  --show                       Show current default config or merchant effective config
  --history                    Show fee config change audit history
  (default action)             Update (or --dry-run / --preview) fee configuration

Target:
  --default                    Target system_configs (MERCHANT_FEE_CONFIG or USER_FEE_CONFIG)
  --role <MERCHANT|USER>       Role for --default target (default: MERCHANT)
  --merchant-id <uuid>         Target specific merchant for --show or --history only

Config fields:
  --rate-percent <0..100>      Per-transaction fee % (e.g. 1, 0.75)
  --rate-bps <0..10000>        Per-transaction fee in bps (100 = 1%)
  --min-fee <int|null>         Minimum fee in VND (non-negative integer)
  --max-fee <int|null>         Maximum fee in VND ("null" = unlimited)
  --free-threshold <int|null>  Exempt transactions strictly below this amount (VND)
  --transfer-fee-percent <n>   Merchant outbound P2P transfer fee % (default 0)
  --transfer-fee-bps <int>     Merchant outbound P2P transfer fee in bps (default 0)
  --transfer-min-fee <int|nul> Merchant outbound P2P min fee in VND (default 0)
  --transfer-max-fee <int|nul> Merchant outbound P2P max fee in VND ("null" = unlimited)
  --withdraw-fee-percent <n>   Withdraw fee % on excess above monthly free quota
  --withdraw-fee-bps <int>     Withdraw fee in bps
  --withdraw-free-quota <int>  Free withdraw quota per month (VND)
  --monthly-plan-enabled <b|n> true | false | null
  --monthly-plan-fee <int>     Monthly fee in VND (default 300000 when enabled)
  --monthly-grace-days <int>   PAST_DUE grace window in days (0..31, --default only)
  --effective-from <ISO-date>  Future/current ISO timestamp (no past timestamps allowed)
  --tiers <json>               JSON array of tier rules (default [])

Execution & Audit flags:
  --reason "<text>"            Audit reason (5..500 chars; required for actual updates)
  --dry-run | --preview        Simulate changes on sample amounts without writing to DB
  --samples "10000,50000,..."  Custom sample amounts (comma-separated VND)
  --help                       Show this help message
`);
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      throw new Error(`Tham số không hợp lệ: ${arg}`);
    }
    const key = arg.slice(2);
    const booleanFlags = new Set([
      "help",
      "default",
      "show",
      "history",
      "dry-run",
      "preview",
    ]);
    if (booleanFlags.has(key)) {
      opts[key] = true;
      continue;
    }
    const eqIdx = key.indexOf("=");
    if (eqIdx !== -1) {
      opts[key.slice(0, eqIdx)] = key.slice(eqIdx + 1);
      continue;
    }
    const val = argv[i + 1];
    if (val === undefined || val.startsWith("--")) {
      throw new Error(`Thiếu giá trị cho --${key}`);
    }
    opts[key] = val;
    i++;
  }
  return opts;
}

function promptText(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function promptPasswordHidden(question) {
  return new Promise((resolve) => {
    let muted = false;
    const mutableStdout = new Writable({
      write(chunk, encoding, callback) {
        if (!muted) process.stdout.write(chunk, encoding);
        callback();
      },
    });
    const rl = readline.createInterface({
      input: process.stdin,
      output: mutableStdout,
      terminal: true,
    });
    process.stdout.write(question);
    muted = true;
    rl.question("", (password) => {
      muted = false;
      process.stdout.write("\n");
      rl.close();
      resolve(password);
    });
  });
}

async function authenticateAdmin(opts) {
  if (opts.password) {
    throw new Error(
      "Không truyền mật khẩu qua --password để tránh lộ credential trong shell history. Hãy dùng biến môi trường ADMIN_PASSWORD hoặc nhập khi được hỏi.",
    );
  }
  let email = opts["admin-email"] || process.env.ADMIN_EMAIL || "";
  if (!email && process.stdin.isTTY) {
    email = await promptText("Admin Email: ");
  }
  let password = process.env.ADMIN_PASSWORD || "";
  if (!password && process.stdin.isTTY) {
    password = await promptPasswordHidden("Admin Password: ");
  }
  if (!email || !password) {
    throw new Error(
      "Thiếu xác thực Admin (cung cấp ADMIN_EMAIL & ADMIN_PASSWORD hoặc nhập tương tác qua terminal)",
    );
  }
  return adminAuthService.checkAdminCredentials(email.trim(), password);
}

function parseNullableIntFlag(raw) {
  if (raw === undefined) return undefined;
  if (String(raw).trim().toLowerCase() === "null") return null;
  return Number(raw);
}

function parseNullableRateFlag(raw) {
  if (raw === undefined) return undefined;
  if (String(raw).trim().toLowerCase() === "null") return null;
  return Number(raw);
}

function parseNullableBoolFlag(raw) {
  if (raw === undefined) return undefined;
  const s = String(raw).trim().toLowerCase();
  if (s === "null") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  throw new Error(`Giá trị boolean không hợp lệ: ${raw}`);
}

function buildConfigPayloadFromOpts(opts) {
  const payload = {};
  if (opts["rate-percent"] !== undefined) {
    payload.rate_percent = parseNullableRateFlag(opts["rate-percent"]);
  }
  if (opts["rate-bps"] !== undefined) {
    payload.rate_bps = parseNullableIntFlag(opts["rate-bps"]);
  }
  if (opts["min-fee"] !== undefined) {
    payload.min_fee = parseNullableIntFlag(opts["min-fee"]);
  }
  if (opts["max-fee"] !== undefined) {
    const val = parseNullableIntFlag(opts["max-fee"]);
    payload.max_fee = val;
    payload.max_fee_unbounded = val === null;
  }
  if (opts["free-threshold"] !== undefined) {
    payload.free_threshold_amount = parseNullableIntFlag(opts["free-threshold"]);
  }
  if (opts["transfer-fee-percent"] !== undefined) {
    payload.transfer_fee_percent = parseNullableRateFlag(
      opts["transfer-fee-percent"],
    );
  }
  if (opts["transfer-fee-bps"] !== undefined) {
    payload.transfer_fee_bps = parseNullableIntFlag(opts["transfer-fee-bps"]);
  }
  if (opts["transfer-min-fee"] !== undefined) {
    payload.transfer_min_fee = parseNullableIntFlag(opts["transfer-min-fee"]);
  }
  if (opts["transfer-max-fee"] !== undefined) {
    const val = parseNullableIntFlag(opts["transfer-max-fee"]);
    payload.transfer_max_fee = val;
    payload.transfer_max_fee_unbounded = val === null;
  }
  if (opts["withdraw-fee-percent"] !== undefined) {
    payload.withdraw_fee_percent = parseNullableRateFlag(
      opts["withdraw-fee-percent"],
    );
  }
  if (opts["withdraw-fee-bps"] !== undefined) {
    payload.withdraw_fee_bps = parseNullableIntFlag(opts["withdraw-fee-bps"]);
  }
  if (opts["withdraw-free-quota"] !== undefined) {
    payload.withdraw_free_quota_per_month = parseNullableIntFlag(
      opts["withdraw-free-quota"],
    );
  }
  if (opts["monthly-plan-enabled"] !== undefined) {
    payload.monthly_plan_enabled = parseNullableBoolFlag(
      opts["monthly-plan-enabled"],
    );
  }
  if (opts["monthly-plan-fee"] !== undefined) {
    payload.monthly_plan_fee = parseNullableIntFlag(opts["monthly-plan-fee"]);
  }
  if (opts["monthly-grace-days"] !== undefined) {
    payload.monthly_grace_days = parseNullableIntFlag(
      opts["monthly-grace-days"],
    );
  }
  if (opts["effective-from"] !== undefined) {
    payload.effective_from = opts["effective-from"];
  }
  if (opts.tiers !== undefined) {
    payload.tiers = JSON.parse(opts.tiers);
  }
  return payload;
}

function printSimulation(simulation = []) {
  if (!simulation.length) return;
  console.log("\nMo phong phi theo cac muc giao dich mau (VND):");
  console.table(
    simulation.map((row) => ({
      amount: row.amount,
      qr_old_fee: row.qr_payment.old_fee,
      qr_new_fee: row.qr_payment.new_fee,
      qr_new_net: row.qr_payment.new_net,
      p2p_new_fee: row.transfer_outbound?.new_fee ?? 0,
      wd_old_fee: row.withdraw.old_fee,
      wd_new_fee: row.withdraw.new_fee,
      wd_new_debit: row.withdraw.new_total_debit,
    })),
  );
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  const adminUser = await authenticateAdmin(opts);
  const rawOperator = (opts.actor || adminUser.email || adminUser.id).trim();
  const actorLabel = rawOperator.startsWith("cli:")
    ? rawOperator
    : `cli:${rawOperator}`;

  const sampleAmounts = opts.samples
    ? String(opts.samples)
        .split(",")
        .map((s) => Number(s.trim()))
    : undefined;

  if (opts.history) {
    const history = await adminMerchantFeeService.getFeeConfigHistory({
      merchantId: opts["merchant-id"] || null,
      limit: opts.limit || 20,
    });
    console.log(JSON.stringify(history, null, 2));
    return;
  }

  const isMerchantTarget = Boolean(opts["merchant-id"]);
  const isDefaultTarget = Boolean(opts.default) || !isMerchantTarget;
  const role = opts.role || "MERCHANT";

  if (opts.show) {
    const result = isMerchantTarget
      ? await adminMerchantFeeService.getMerchantFeeConfig(opts["merchant-id"])
      : await adminMerchantFeeService.getDefaultFeeConfig({ role });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const payload = buildConfigPayloadFromOpts(opts);
  const dryRun = Boolean(opts["dry-run"] || opts.preview);

  if (isMerchantTarget) {
    throw new Error(
      "Hệ thống áp dụng biểu phí bậc thang thống nhất từ cấu hình hệ thống (--default), không hỗ trợ cập nhật biểu phí riêng theo --merchant-id.",
    );
  }

  if (isDefaultTarget) {
    const res = await adminMerchantFeeService.updateDefaultFeeConfig({
      role,
      config: payload,
      reason: opts.reason,
      adminId: adminUser.id,
      actorLabel,
      dryRun,
      sampleAmounts,
    });
    console.log(
      JSON.stringify(
        {
          dry_run: res.dry_run,
          key: res.key,
          role: res.role,
          actor: actorLabel,
          old_config: res.old_config,
          new_config: res.new_config || res.proposed_config,
          audit: res.audit || null,
        },
        null,
        2,
      ),
    );
    printSimulation(res.simulation);
  }
}

main()
  .catch((err) => {
    console.error(`[CLI ERROR] ${err.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch (_) {}
  });


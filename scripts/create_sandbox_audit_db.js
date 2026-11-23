// create_sandbox_audit_db.js: Script khởi tạo riêng database MongoDB ewallet_audit_db_sandbox (các collection và index audit) cho môi trường sandbox.
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const mongoose = require("mongoose");

const { AdminActionLog } = require("../src/models/mongo/adminActionLog.model");
const { UserLoginEvent } = require("../src/models/mongo/userLoginEvent.model");
const {
  LoginStatsDailyUser,
  LoginStatsRollupState,
} = require("../src/models/mongo/loginStatsDailyUser.model");
const { SecurityEvent } = require("../src/models/mongo/securityEvent.model");

const SANDBOX_DEFAULT_DB_NAME = "ewallet_audit_db_sandbox";
const SANDBOX_AUDIT_MODELS = [
  AdminActionLog,
  UserLoginEvent,
  LoginStatsDailyUser,
  LoginStatsRollupState,
  SecurityEvent,
];

function resolveSandboxMongoUri() {
  const explicitUri = String(process.env.MONGODB_URI || "").trim();
  const explicitEnv = String(process.env.NODE_ENV || "").trim();
  if (explicitUri && (!explicitEnv || explicitEnv === "sandbox")) {
    return explicitUri;
  }

  const sandboxEnvPath = path.join(__dirname, "../.env.sandbox");
  if (!fs.existsSync(sandboxEnvPath)) {
    throw new Error("Không tìm thấy tệp cấu hình .env.sandbox");
  }
  const parsed = dotenv.parse(fs.readFileSync(sandboxEnvPath, "utf8"));
  const uri = String(parsed.MONGODB_URI || "").trim();
  if (!uri) {
    throw new Error("Thiếu MONGODB_URI trong .env.sandbox");
  }
  return uri;
}

function extractMongoDbName(uri) {
  let parsed;
  try {
    parsed = new URL(uri);
  } catch (_) {
    throw new Error(`MONGODB_URI không hợp lệ: "${uri}"`);
  }
  const dbName = parsed.pathname.replace(/^\/+/, "").split("/")[0].trim();
  if (!dbName) {
    throw new Error("MONGODB_URI phải chỉ rõ tên database MongoDB sandbox");
  }
  if (dbName !== SANDBOX_DEFAULT_DB_NAME && !dbName.endsWith("_sandbox")) {
    throw new Error(
      `Từ chối khởi tạo: database "${dbName}" không phải database sandbox (mong đợi "${SANDBOX_DEFAULT_DB_NAME}")`,
    );
  }
  return dbName;
}

async function ensureSandboxAuditDatabase(uri = resolveSandboxMongoUri(), { timeoutMs = 5000 } = {}) {
  const dbName = extractMongoDbName(uri);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: timeoutMs,
    bufferCommands: false,
  });

  try {
    const db = mongoose.connection.db;
    const existing = new Set(
      (await db.listCollections().toArray()).map((c) => c.name),
    );

    const summary = [];
    for (const Model of SANDBOX_AUDIT_MODELS) {
      const colName = Model.collection.collectionName;
      let createdCollection = false;
      if (!existing.has(colName)) {
        await Model.createCollection();
        createdCollection = true;
      }
      await Model.createIndexes();
      const indexes = await Model.collection.indexes();
      summary.push({
        collection: colName,
        createdCollection,
        indexCount: indexes.length,
      });
    }

    return { dbName, summary };
  } finally {
    await mongoose.disconnect();
  }
}

async function main() {
  const isSoft = process.argv.includes("--soft");
  try {
    const uri = resolveSandboxMongoUri();
    const { dbName, summary } = await ensureSandboxAuditDatabase(uri, {
      timeoutMs: isSoft ? 3000 : 5000,
    });
    const createdCount = summary.filter((s) => s.createdCollection).length;
    console.log(
      `[sandbox-mongo] Đã sẵn sàng DB "${dbName}" (${summary.length} collections, tạo mới ${createdCount}).`,
    );
    if (!isSoft) {
      for (const item of summary) {
        console.log(
          `  - ${item.collection}: ${item.indexCount} indexes${item.createdCollection ? " (created)" : ""}`,
        );
      }
    }
  } catch (err) {
    if (isSoft) {
      console.warn(
        `[sandbox-mongo] Bỏ qua khởi tạo trước khi chạy sandbox: ${err.message}`,
      );
      return;
    }
    console.error(`[sandbox-mongo] Lỗi khởi tạo database sandbox: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  void main();
}

module.exports = {
  SANDBOX_DEFAULT_DB_NAME,
  SANDBOX_AUDIT_MODELS,
  resolveSandboxMongoUri,
  extractMongoDbName,
  ensureSandboxAuditDatabase,
};


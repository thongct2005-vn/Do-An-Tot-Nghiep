const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const mongoose = require("mongoose");
const pool = require("../src/config/database");
const { UserLoginEvent } = require("../src/models/mongo/userLoginEvent.model");
const {
  LoginStatsDailyUser,
  backfillLoginStatsDailyUsers,
} = require("../src/models/mongo/loginStatsDailyUser.model");
const {
  addDaysToDateStr,
  getCurrentMonthBoundsInVietnam,
} = require("../src/utils/dateRange");
const adminUserService = require("../src/admin/user/user.service");

function parseArgs(argv) {
  const args = {
    start: "2024-01-01",
    end: null,
    minPerDay: 35,
    maxPerDay: 70,
    reset: false,
  };

  for (const raw of argv) {
    if (raw === "--reset") {
      args.reset = true;
    } else if (raw.startsWith("--start=")) {
      args.start = raw.slice("--start=".length).trim();
    } else if (raw.startsWith("--end=")) {
      args.end = raw.slice("--end=".length).trim();
    } else if (raw.startsWith("--min-per-day=")) {
      args.minPerDay = Math.max(1, Number(raw.slice("--min-per-day=".length)) || 35);
    } else if (raw.startsWith("--max-per-day=")) {
      args.maxPerDay = Math.max(args.minPerDay, Number(raw.slice("--max-per-day=".length)) || 70);
    }
  }

  return args;
}

function createPrng(seed = 20240101) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();
  const todayVn = getCurrentMonthBoundsInVietnam(now).endDate;
  const startDate = args.start;
  const endDate = args.end || todayVn;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error("Định dạng ngày không hợp lệ (cần YYYY-MM-DD)");
  }
  if (startDate > endDate) {
    throw new Error(`startDate (${startDate}) phải <= endDate (${endDate})`);
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is required");
  }

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
    bufferCommands: false,
  });

  try {
    const existingCount = await UserLoginEvent.collection.countDocuments({});
    if (existingCount > 0 && !args.reset) {
      console.log(
        `Đã tồn tại ${existingCount} bản ghi trong user_login_events. Bỏ qua để tránh trùng lặp (chạy lại với --reset nếu muốn tạo mới từ đầu).`,
      );
      return;
    }

    let usersRes = await pool.query(
      "SELECT id FROM users WHERE role = 'USER' AND status = 'ACTIVE' ORDER BY created_at ASC, id ASC",
    );
    if (usersRes.rows.length === 0) {
      usersRes = await pool.query(
        "SELECT id FROM users WHERE role = 'USER' ORDER BY created_at ASC, id ASC",
      );
    }
    const userIds = usersRes.rows.map((r) => String(r.id));
    if (userIds.length === 0) {
      throw new Error("Không tìm thấy tài khoản USER nào trong PostgreSQL để gán lượt đăng nhập.");
    }

    if (args.reset) {
      await UserLoginEvent.collection.deleteMany({});
      await LoginStatsDailyUser.collection.deleteMany({});
      console.log("Đã xóa dữ liệu cũ trong user_login_events và login_stats_daily_users.");
    }

    const rand = createPrng(20240101);

    // Chọn một tập người dùng thường xuyên (~15% tổng số USER, tối đa 1.200) để biểu đồ ngày & tháng có độ lặp tự nhiên (unique_users < total_logins)
    const activeCohortSize = Math.min(userIds.length, Math.max(100, Math.min(1200, Math.floor(userIds.length * 0.15))));
    const shuffled = [...userIds];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const frequentCohort = shuffled.slice(0, activeCohortSize);

    const BATCH_SIZE = 5000;
    let batch = [];
    let totalInserted = 0;
    let totalDays = 0;

    let currDate = startDate;
    while (currDate <= endDate) {
      totalDays += 1;
      const dayStartMs = Date.parse(`${currDate}T00:00:00.000+07:00`);
      const earliestMs = dayStartMs + 6 * 3600 * 1000; // 06:00 GMT+7
      const fullDayEndMs = dayStartMs + 23 * 3600 * 1000 + 55 * 60 * 1000; // 23:55 GMT+7

      let windowStartMs = earliestMs;
      let windowEndMs = fullDayEndMs;
      let dayCount = args.minPerDay + Math.floor(rand() * (args.maxPerDay - args.minPerDay + 1));

      if (currDate === todayVn) {
        const safeNowMs = now.getTime() - 60 * 1000;
        if (safeNowMs <= dayStartMs + 60 * 1000) {
          windowStartMs = dayStartMs + 1000;
          windowEndMs = Math.max(windowStartMs + 1000, now.getTime());
          dayCount = Math.max(5, Math.floor(args.minPerDay * 0.25));
        } else {
          if (safeNowMs < earliestMs) {
            windowStartMs = dayStartMs + 60 * 1000;
          }
          windowEndMs = Math.min(fullDayEndMs, safeNowMs);
          const elapsedRatio = Math.max(
            0.2,
            Math.min(1, (windowEndMs - windowStartMs) / (fullDayEndMs - earliestMs)),
          );
          dayCount = Math.max(10, Math.round(dayCount * elapsedRatio));
        }
      }

      const dayUsedUsers = [];
      for (let i = 0; i < dayCount; i += 1) {
        let chosenUserId;
        if (dayUsedUsers.length > 0 && rand() < 0.28) {
          // ~28% người dùng đăng nhập lại trong cùng ngày
          chosenUserId = dayUsedUsers[Math.floor(rand() * dayUsedUsers.length)];
        } else if (rand() < 0.65) {
          chosenUserId = frequentCohort[Math.floor(rand() * frequentCohort.length)];
        } else {
          chosenUserId = userIds[Math.floor(rand() * userIds.length)];
        }
        dayUsedUsers.push(chosenUserId);

        const tsMs = Math.floor(
          windowStartMs + rand() * Math.max(1000, windowEndMs - windowStartMs),
        );
        batch.push({
          user_id: chosenUserId,
          status: "SUCCESS",
          logged_in_at: new Date(tsMs),
        });

        if (batch.length >= BATCH_SIZE) {
          await UserLoginEvent.collection.insertMany(batch, { ordered: false });
          totalInserted += batch.length;
          batch = [];
        }
      }

      currDate = addDaysToDateStr(currDate, 1);
    }

    if (batch.length > 0) {
      await UserLoginEvent.collection.insertMany(batch, { ordered: false });
      totalInserted += batch.length;
      batch = [];
    }

    await UserLoginEvent.createIndexes();
    const backfillRes = await backfillLoginStatsDailyUsers({ now });

    const overallStats = await adminUserService.getLoginStats({
      start_date: startDate,
      end_date: endDate,
      now,
    });
    const currentMonthBounds = getCurrentMonthBoundsInVietnam(now);
    const currentMonthStats = await adminUserService.getLoginStats({
      start_date: currentMonthBounds.startDate,
      end_date: currentMonthBounds.endDate,
      now,
    });

    console.log("Seed user_login_events hoàn tất:", {
      startDate,
      endDate,
      totalDays,
      activePgUsers: userIds.length,
      totalInserted,
      backfill: backfillRes,
      overallSummary: overallStats.summary,
      overallBucketsCount: overallStats.buckets.length,
      currentMonthRange: currentMonthBounds,
      currentMonthSummary: currentMonthStats.summary,
    });
  } finally {
    await Promise.allSettled([pool.end(), mongoose.disconnect()]);
  }
}

main().catch((err) => {
  console.error("Seed user_login_events thất bại:", err);
  process.exit(1);
});

// transaction.service.js: Nghiệp vụ chuyển/nạp/rút, lịch sử, thống kê doanh thu, OTP giao dịch và hạn mức cho Merchant.
const merchantTransactionRepository = require("./transaction.repository");
const merchantAuthService = require("../auth/auth.service");
const otpService = require("../../../otp/otp.service");
const tokenUtil = require("../../../../utils/auth/jwt");
const { httpError } = require("../../../../utils/common/http");
const { computePinBinding } = require("../../../../utils/security/pinBinding");
const {
  maskEmail,
  maskPhone,
  maskAccountNumber,
} = require("../../../../utils/common/text");
const { isValidPhone } = require("../../../../utils/common/validators");
const {
  formatVnd,
  parseAmountInRange,
  assertBankFundingMinAmount,
} = require("../../../../utils/common/amount");
const pool = require("../../../../config/database");
const {
  getEffectiveTransactionLimit,
  getPositiveIntConfig,
} = require("../../../../utils/limits/limitsDb");
const { getTransactionLimitsSummary } = require("../../../../utils/limits/dailyLimit");
const {
  fetchTransactionLimits,
  updateUserTransactionLimit,
  resetUserTransactionLimit,
} = require("../../../../utils/limits/userLimitsService");
const userRepository = require("../../../user/user.repository");
const {
  resolveExportRange,
  resolveOneYearRange,
} = require("../../../../utils/common/dateRange");
const {
  buildTransactionsXlsx,
  buildRevenueStatsXlsx,
  buildExportFileName,
} = require("../../../../utils/files/exportExcel");
const userTransactionRepository = require("../../../transaction/transaction.repository");
const { assertKyc, assertKycBoth } = require("../../../kyc/kyc.guard");
const {
  normalizeTypeAndDirection,
  normalizeHistoryStatus,
  normalizeAmountRange,
  normalizeFundingSourceFilter,
} = require("../../../../utils/payment/historyFilters");
const {
  TRANSACTION_TYPES,
  MERCHANT_FUNDING_ALIAS_MAP,
  toNumberOrNull,
  getOtpMerchant,
  normalizeProductIdFilter,
  resolveRevenueChartWindow,
  buildRevenueChartBuckets,
} = require("./transaction.helpers");

const merchantTransactionService = {
  async transferMoney({
    sourceUserId,
    destinationUserId,
    amount,
    description,
    idempotencyKey,
    linkedBankAccountId = null,
    fundingSource = null,
  }) {
    if (!sourceUserId || !destinationUserId) {
      throw httpError(400, "Thiếu thông tin người gửi hoặc người nhận");
    }

    if (sourceUserId === destinationUserId) {
      throw httpError(400, "Không thể chuyển tiền cho chính mình");
    }

    const normalizedFunding = String(fundingSource || (linkedBankAccountId ? "BANK" : "MAIN_WALLET"))
      .trim()
      .toUpperCase();
    const isBankFunded = normalizedFunding === "BANK" || Boolean(linkedBankAccountId);
    const candidateAmount = userTransactionRepository.parsePositiveAmountForFailure(amount);

    const numAmount = await userTransactionRepository.runPreCheckWithFailureRecord(
      candidateAmount !== null
        ? {
            transactionType: "TRANSFER",
            sourceUserId,
            destinationUserId,
            amount: candidateAmount,
            linkedBankAccountId: isBankFunded ? linkedBankAccountId : null,
            feeRateSnapshot: userTransactionRepository.buildTransferFailureSnapshot({
              isBankFunded,
              userMessage: description,
            }),
          }
        : null,
      async () => {
        await assertKycBoth(sourceUserId, destinationUserId);

        const transferRule = await getEffectiveTransactionLimit(pool, {
          userId: sourceUserId,
          role: "MERCHANT",
          transactionType: "TRANSFER",
        });
        const parsed = parseAmountInRange(amount, transferRule, "chuyển");
        if (isBankFunded) {
          assertBankFundingMinAmount(parsed, "chuyển tiền");
        }
        return parsed;
      },
    );

    return await merchantTransactionRepository.transferMoney({
      sourceUserId,
      destinationUserId,
      amount: numAmount,
      fee: 0,
      description,
      idempotencyKey,
      transactionType: "TRANSFER",
      status: "SUCCESS",
      linkedBankAccountId,
      fundingSource,
    });
  },

  async topupMoney({
    sourceUserId,
    amount,
    idempotencyKey,
    linkedBankAccountId,
  }) {
    if (!sourceUserId) {
      throw httpError(400, "Thiếu thông tin người thực hiện giao dịch");
    }

    const candidateAmount = userTransactionRepository.parsePositiveAmountForFailure(amount);
    const numAmount = await userTransactionRepository.runPreCheckWithFailureRecord(
      candidateAmount !== null && linkedBankAccountId
        ? {
            transactionType: "TOPUP",
            sourceUserId,
            amount: candidateAmount,
            linkedBankAccountId,
          }
        : null,
      async () => {
        await assertKyc(sourceUserId);

        const topupRule = await getEffectiveTransactionLimit(pool, {
          userId: sourceUserId,
          role: "MERCHANT",
          transactionType: "TOPUP",
        });
        const parsed = parseAmountInRange(amount, topupRule, "nạp");

        if (!linkedBankAccountId) {
          throw httpError(400, "Thiếu thông tin ngân hàng liên kết");
        }
        return parsed;
      },
    );

    return await merchantTransactionRepository.topupMoney({
      sourceUserId,
      amount: numAmount,
      fee: 0,
      idempotencyKey,
      transactionType: "TOPUP",
      status: "SUCCESS",
      linkedBankAccountId: linkedBankAccountId,
    });
  },

  async withdrawMoney({
    sourceUserId,
    amount,
    idempotencyKey,
    linkedBankAccountId,
  }) {
    if (!sourceUserId) {
      throw httpError(400, "Thiếu thông tin người thực hiện giao dịch");
    }

    const candidateAmount = userTransactionRepository.parsePositiveAmountForFailure(amount);
    const numAmount = await userTransactionRepository.runPreCheckWithFailureRecord(
      candidateAmount !== null && linkedBankAccountId
        ? {
            transactionType: "WITHDRAW",
            sourceUserId,
            amount: candidateAmount,
            linkedBankAccountId,
          }
        : null,
      async () => {
        await assertKyc(sourceUserId);

        const withdrawRule = await getEffectiveTransactionLimit(pool, {
          userId: sourceUserId,
          role: "MERCHANT",
          transactionType: "WITHDRAW",
        });
        const parsed = parseAmountInRange(amount, withdrawRule, "rút");

        if (!linkedBankAccountId) {
          throw httpError(400, "Thiếu thông tin ngân hàng liên kết");
        }
        return parsed;
      },
    );

    return await merchantTransactionRepository.withdrawMoney({
      sourceUserId,
      amount: numAmount,
      fee: 0,
      idempotencyKey,
      transactionType: "WITHDRAW",
      status: "SUCCESS",
      linkedBankAccountId: linkedBankAccountId,
    });
  },

  // Xuất lịch sử giao dịch ra file Excel (web merchant)
  async exportHistory(
    userId,
    {
      keyword,
      type,
      direction = null,
      startDate,
      endDate,
      productId,
      status = null,
      minAmount = null,
      maxAmount = null,
      fundingSource = null,
    },
  ) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin để xuất lịch sử giao dịch");
    }

    const range = resolveExportRange(startDate, endDate);
    const normalizedKeyword = keyword && keyword.trim() ? keyword.trim() : null;
    const normalizedProductId = normalizeProductIdFilter(productId);
    const { type: normalizedType, direction: normalizedDirection } =
      normalizeTypeAndDirection({
        type,
        direction,
        allowedTypes: TRANSACTION_TYPES,
      });
    const normalizedStatus = normalizeHistoryStatus(status);
    const { minAmount: parsedMinAmount, maxAmount: parsedMaxAmount } =
      normalizeAmountRange(minAmount, maxAmount);
    const normalizedFundingSource = normalizeFundingSourceFilter(
      fundingSource,
      MERCHANT_FUNDING_ALIAS_MAP,
    );

    const exportMaxRows = await getPositiveIntConfig("EXPORT_MAX_ROWS", pool);
    const rows = await merchantTransactionRepository.exportHistory(userId, {
      keyword: normalizedKeyword,
      type: normalizedType,
      direction: normalizedDirection,
      startDate: range.startDate,
      endDate: range.endDate,
      productId: normalizedProductId,
      status: normalizedStatus,
      minAmount: parsedMinAmount,
      maxAmount: parsedMaxAmount,
      fundingSource: normalizedFundingSource,
      limit: exportMaxRows + 1,
    });
    if (rows.length > exportMaxRows) {
      throw httpError(
        400,
        `Có hơn ${exportMaxRows.toLocaleString("vi-VN")} giao dịch trong khoảng thời gian này, vui lòng chọn khoảng ngắn hơn hoặc thêm bộ lọc`,
      );
    }

    const filters = [];
    if (normalizedType) {
      if (normalizedType === "TRANSFER" && normalizedDirection) {
        filters.push(
          `dịch vụ ${normalizedDirection === "OUT" ? "Chuyển tiền" : "Nhận tiền"}`,
        );
      } else if (normalizedType === "REFUND" && normalizedDirection) {
        filters.push(
          `dịch vụ ${normalizedDirection === "OUT" ? "Hoàn tiền cho khách" : "Nhận hoàn tiền"}`,
        );
      } else {
        filters.push(`loại ${normalizedType}`);
      }
    }
    if (normalizedStatus) filters.push(`trạng thái ${normalizedStatus}`);
    if (normalizedFundingSource) {
      filters.push(
        `nguồn ${normalizedFundingSource === "BANK" ? "Ngân hàng liên kết" : "Ví LumaPay Merchant"}`,
      );
    }
    if (parsedMinAmount !== null || parsedMaxAmount !== null) {
      const fromText = parsedMinAmount !== null ? formatVnd(parsedMinAmount) : "0đ";
      const toText = parsedMaxAmount !== null ? formatVnd(parsedMaxAmount) : "Không giới hạn";
      filters.push(`số tiền ${fromText} - ${toText}`);
    }
    if (normalizedProductId) filters.push(`sản phẩm ${normalizedProductId}`);
    if (normalizedKeyword) filters.push(`từ khóa "${normalizedKeyword}"`);

    const buffer = await buildTransactionsXlsx({
      rows,
      startDate: range.startDate,
      endDate: range.endDate,
      filters,
    });

    await userTransactionRepository.recordAuditSafe({
      eventType: "TRANSACTION_HISTORY_EXPORTED",
      payload: {
        user_id: userId,
        channel: "MERCHANT_WEB",
        start_date: range.startDate,
        end_date: range.endDate,
        type: normalizedType,
        direction: normalizedDirection,
        status: normalizedStatus,
        min_amount: parsedMinAmount,
        max_amount: parsedMaxAmount,
        funding_source: normalizedFundingSource,
        keyword: normalizedKeyword,
        product_id: normalizedProductId,
        row_count: rows.length,
      },
    });

    return {
      buffer,
      fileName: buildExportFileName(range.startDate, range.endDate),
    };
  },

  async getTransferHistory(
    userId,
    {
      cursorId,
      limit,
      keyword,
      type,
      direction = null,
      startDate,
      endDate,
      sort,
      sortBy,
      productId,
      status = null,
      minAmount = null,
      maxAmount = null,
      fundingSource = null,
    },
  ) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin để lấy lịch sử giao dịch");
    }

    const historyPageLimit = await getPositiveIntConfig("HISTORY_PAGE_LIMIT", pool);
    const maxLimit = Math.min(
      Number(limit) || historyPageLimit,
      historyPageLimit,
    );
    const normalizedKeyword = keyword && keyword.trim() ? keyword.trim() : null;
    const normalizedProductId = normalizeProductIdFilter(productId);

    const { type: normalizedType, direction: normalizedDirection } =
      normalizeTypeAndDirection({
        type,
        direction,
        allowedTypes: TRANSACTION_TYPES,
      });
    const normalizedStatus = normalizeHistoryStatus(status);
    const { minAmount: parsedMinAmount, maxAmount: parsedMaxAmount } =
      normalizeAmountRange(minAmount, maxAmount);
    const normalizedFundingSource = normalizeFundingSourceFilter(
      fundingSource,
      MERCHANT_FUNDING_ALIAS_MAP,
    );

    const normalizedSort =
      sort !== undefined && sort !== null && String(sort).trim()
        ? String(sort).trim().toUpperCase()
        : "DESC";
    if (!["ASC", "DESC"].includes(normalizedSort)) {
      throw httpError(400, "Thứ tự sắp xếp không hợp lệ");
    }

    const normalizedSortBy =
      sortBy !== undefined && sortBy !== null && String(sortBy).trim()
        ? String(sortBy).trim().toLowerCase()
        : "time";
    if (!["time", "amount", "id"].includes(normalizedSortBy)) {
      throw httpError(400, "Trường sắp xếp không hợp lệ");
    }

    let parsedCursorId = cursorId || null;
    let parsedCursorAmount = null;
    if (normalizedSortBy === "amount" && cursorId) {
      const sepIdx = String(cursorId).indexOf(":");
      if (sepIdx <= 0) {
        throw httpError(400, "Con trỏ phân trang không hợp lệ");
      }
      const amtNum = Number(String(cursorId).slice(0, sepIdx));
      const txIdPart = String(cursorId).slice(sepIdx + 1).trim();
      if (!Number.isFinite(amtNum) || !txIdPart) {
        throw httpError(400, "Con trỏ phân trang không hợp lệ");
      }
      parsedCursorAmount = Math.trunc(amtNum);
      parsedCursorId = txIdPart;
    }

    // Ngày được giữ dạng chuỗi YYYY-MM-DD, repository sẽ tính theo giờ Việt Nam
    const { startDate: startDay, endDate: endDay } = resolveOneYearRange(
      startDate,
      endDate,
      {
        defaultToOneYear: true,
        tooOldMessage:
          "Chỉ có thể xem lịch sử giao dịch trong vòng 1 năm gần nhất",
      },
    );

    const result = await merchantTransactionRepository.getTransferHistory(
      userId,
      {
        cursorId: parsedCursorId,
        cursorAmount: parsedCursorAmount,
        limit: maxLimit,
        keyword: normalizedKeyword,
        type: normalizedType,
        direction: normalizedDirection,
        startDate: startDay,
        endDate: endDay,
        sort: normalizedSort,
        sortBy: normalizedSortBy,
        productId: normalizedProductId,
        status: normalizedStatus,
        minAmount: parsedMinAmount,
        maxAmount: parsedMaxAmount,
        fundingSource: normalizedFundingSource,
      },
    );

    return result;
  },

  async getTransactionDetail(userId, transactionId) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin để lấy chi tiết giao dịch");
    }

    const id = transactionId ? String(transactionId).trim() : "";
    if (!id || id.length > 100) {
      throw httpError(400, "Mã giao dịch không hợp lệ");
    }

    const row = await merchantTransactionRepository.getTransactionDetail(
      userId,
      id,
    );
    if (!row) {
      throw httpError(404, "Không tìm thấy giao dịch");
    }

    const type = row.transaction_type;
    const isBankType = type === "TOPUP" || type === "WITHDRAW";
    const amountNum = Number(row.amount);
    const merchantFeeNum = Number(row.merchant_fee || 0);
    const computedNetAmount =
      row.direction === "IN" ? Math.max(0, amountNum - merchantFeeNum) : amountNum;

    const detail = {
      id: row.id,
      transaction_type: type,
      status: row.status,
      direction: row.direction,
      funding_source: row.funding_source || "Ví LumaPay",
      amount: Number(row.amount),
      fee: Number(row.fee),
      merchant_fee: merchantFeeNum,
      fee_rate_snapshot: row.fee_rate_snapshot || null,
      net_amount:
        row.net_amount !== null && row.net_amount !== undefined
          ? Number(row.net_amount)
          : computedNetAmount,
      description: row.description,
      created_at: row.created_at,
      completed_at: row.completed_at,
      balance_before: toNumberOrNull(row.balance_before),
      balance_after: toNumberOrNull(row.balance_after),
      source: null,
      destination: null,
      bank: null,
      payment: null,
    };

    if (isBankType || row.has_linked_bank) {
      detail.bank = row.bank_name
        ? {
          bank_name: row.bank_name,
          bank_code: row.bank_code,
          logo_url: row.bank_logo_url,
          account_holder_name: row.account_holder_name,
          account_number: maskAccountNumber(row.account_number),
        }
        : null;
    }
    if (!isBankType) {
      if (row.source_user_id) {
        detail.source = {
          full_name: row.source_full_name,
          phone: maskPhone(row.source_phone),
          is_self: String(row.source_user_id) === String(userId),
        };
      }
      if (row.destination_user_id) {
        detail.destination = {
          full_name: row.destination_full_name,
          phone: maskPhone(row.destination_phone),
          is_self: String(row.destination_user_id) === String(userId),
        };
      }
    }

    if (type === "PAYMENT" && row.payment_request_id) {
      const itemRows = await merchantTransactionRepository.getPaymentItems(
        row.payment_request_id,
      );
      const items = itemRows.map((item) => {
        const quantity = Number(item.quantity);
        const unitPrice = Number(item.unit_price);
        return {
          product_id: item.product_id,
          name: item.name,
          description: item.description,
          quantity,
          unit_price: unitPrice,
          line_total: quantity * unitPrice,
        };
      });

      detail.payment = {
        order_id: row.order_id,
        reference_code: row.reference_code,
        status: row.payment_status,
        description: row.payment_description,
        paid_at: row.paid_at,
        expires_at: row.expires_at,
        items,
        items_total: items.reduce((sum, item) => sum + item.line_total, 0),
      };
    }

    return detail;
  },

  async getCurrentMonthSummary(userId) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin để lấy tổng quan giao dịch");
    }

    const result =
      await merchantTransactionRepository.getCurrentMonthSummary(userId);

    return {
      total_expense: result.total_expense,
      total_income: result.total_income,
    };
  },

  async getMerchantStats(userId, { startDate, endDate }) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin người dùng");
    }

    const { startDate: startDay, endDate: endDay } = resolveOneYearRange(
      startDate,
      endDate,
      {
        defaultToOneYear: true,
        tooOldMessage:
          "Chỉ có thể xem thống kê doanh thu trong vòng 1 năm gần nhất",
      },
    );

    const data = await merchantTransactionRepository.getMerchantStats(userId, {
      startDate: startDay,
      endDate: endDay,
    });

    return {
      total_revenue: Number(data.summary.total_revenue),
      gross_revenue: Number(data.summary.gross_revenue),
      total_merchant_fee: Number(data.summary.total_merchant_fee),
      total_orders: Number(data.summary.total_orders),
      avg_order_value: Number(data.summary.avg_order_value),
      refunded_count: Number(data.summary.refunded_count || 0),
      refunded_amount: Number(data.summary.refunded_amount || 0),
      refunded_merchant_fee: Number(data.summary.refunded_merchant_fee || 0),
      daily_stats: data.daily_stats.map((row) => ({
        date: row.date_str,
        revenue: Number(row.revenue),
        gross_revenue: Number(row.gross_revenue),
        merchant_fee: Number(row.merchant_fee),
        order_count: Number(row.order_count),
        refunded_count: Number(row.refunded_count || 0),
        refunded_amount: Number(row.refunded_amount || 0),
        refunded_merchant_fee: Number(row.refunded_merchant_fee || 0),
      })),
    };
  },

  async getRevenueChart(userId, { period = "day", month = "" } = {}) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin người dùng");
    }

    const safePeriod = String(period || "day").trim().toLowerCase();
    if (!["day", "week", "month"].includes(safePeriod)) {
      throw httpError(
        400,
        "Kỳ hiển thị biểu đồ không hợp lệ (chỉ hỗ trợ ngày, tuần hoặc tháng)",
      );
    }

    const safeMonth = month ? String(month).trim() : "";
    if (safeMonth && !/^\d{4}-\d{2}$/.test(safeMonth)) {
      throw httpError(400, "Định dạng tháng không hợp lệ");
    }

    const range = resolveRevenueChartWindow(safePeriod, safeMonth);
    const dailyRows =
      await merchantTransactionRepository.getDailyRevenueStats(userId, {
        startDate: range.startDate,
        endDate: range.endDate,
      });

    const buckets = buildRevenueChartBuckets(
      dailyRows,
      safePeriod,
      range,
      safeMonth,
    );

    let totalRevenue = 0;
    let grossRevenue = 0;
    let totalMerchantFee = 0;
    let totalOrders = 0;
    let peak = null;
    let low = null;

    buckets.forEach((b) => {
      totalRevenue += b.revenue;
      grossRevenue += b.gross_revenue;
      totalMerchantFee += b.merchant_fee;
      totalOrders += b.order_count;
      if (!peak || b.revenue > peak.revenue) peak = b;
      if (!low || b.revenue < low.revenue) low = b;
    });

    const avgPerBucket =
      buckets.length > 0 ? Math.round(totalRevenue / buckets.length) : 0;
    const lowTieCount = low
      ? buckets.filter((b) => b.revenue === low.revenue).length
      : 0;

    return {
      period: safePeriod,
      month: safeMonth || null,
      start_date: range.startDate,
      end_date: range.endDate,
      summary: {
        total_revenue: totalRevenue,
        gross_revenue: grossRevenue,
        total_merchant_fee: totalMerchantFee,
        total_orders: totalOrders,
        avg_per_bucket: avgPerBucket,
        peak: peak
          ? {
            key: peak.key,
            label: peak.label,
            fullLabel: peak.fullLabel,
            startDate: peak.startDate,
            endDate: peak.endDate,
            revenue: peak.revenue,
            gross_revenue: peak.gross_revenue,
            merchant_fee: peak.merchant_fee,
            order_count: peak.order_count,
          }
          : null,
        low: low
          ? {
            key: low.key,
            label: low.label,
            fullLabel: low.fullLabel,
            startDate: low.startDate,
            endDate: low.endDate,
            revenue: low.revenue,
            gross_revenue: low.gross_revenue,
            merchant_fee: low.merchant_fee,
            order_count: low.order_count,
            tie_count: lowTieCount,
          }
          : null,
      },
      buckets,
    };
  },

  async exportMerchantStats(userId, { startDate, endDate, sortBy, sort }) {
    const stats = await this.getMerchantStats(userId, { startDate, endDate });
    const normalizedSortBy = ["date", "orders", "revenue"].includes(
      String(sortBy || "").toLowerCase(),
    )
      ? String(sortBy).toLowerCase()
      : "date";
    const dir = String(sort || "DESC").toUpperCase() === "ASC" ? 1 : -1;

    const sortedDaily = [...stats.daily_stats].sort((a, b) => {
      let cmp = 0;
      if (normalizedSortBy === "orders") {
        cmp = a.order_count - b.order_count;
      } else if (normalizedSortBy === "revenue") {
        cmp = a.revenue - b.revenue;
      } else {
        cmp = String(a.date).localeCompare(String(b.date));
      }
      if (cmp !== 0) return cmp * dir;
      return String(b.date).localeCompare(String(a.date));
    });

    const buffer = await buildRevenueStatsXlsx({
      summary: {
        total_revenue: stats.total_revenue,
        gross_revenue: stats.gross_revenue,
        total_merchant_fee: stats.total_merchant_fee,
        total_orders: stats.total_orders,
        avg_order_value: stats.avg_order_value,
        refunded_count: stats.refunded_count,
        refunded_amount: stats.refunded_amount,
        refunded_merchant_fee: stats.refunded_merchant_fee,
      },
      dailyStats: sortedDaily,
      startDate: startDate || null,
      endDate: endDate || null,
    });

    const fileSuffix =
      startDate && endDate
        ? `${startDate}_den_${endDate}`
        : startDate || endDate || "tat-ca";
    return {
      buffer,
      fileName: `thong-ke-doanh-thu_${fileSuffix}.xlsx`,
    };
  },

  // Gửi OTP xác thực giao dịch. Đồng bộ với đăng nhập:
  // - Đã bật Google Authenticator: không gửi email, merchant nhập mã từ ứng dụng
  // - Chưa bật: gửi OTP qua email (nếu OTP cũ còn hiệu lực thì dùng tiếp)
  async sendTransactionOtp({ userId, phone, riskChallenge = false }) {
    const user = await getOtpMerchant({ userId, phone });
    const hasTaxCode = Boolean(
      user.tax_code && String(user.tax_code).trim().length >= 4,
    );
    const requireTaxCodeLast4 = Boolean(riskChallenge) && hasTaxCode;

    if (user.totp_enabled) {
      return {
        masked_email: maskEmail(user.email),
        otp_method: "totp",
        require_tax_code_last4: requireTaxCodeLast4,
      };
    }

    try {
      await otpService.generateAndSaveOtp({ email: user.email });
    } catch (e) {
      if (e.statusCode !== 429) throw e;
    }

    return {
      masked_email: maskEmail(user.email),
      otp_method: "email",
      require_tax_code_last4: requireTaxCodeLast4,
    };
  },

  async resendTransactionOtp({ userId, phone, riskChallenge = false }) {
    const user = await getOtpMerchant({ userId, phone });
    const hasTaxCode = Boolean(
      user.tax_code && String(user.tax_code).trim().length >= 4,
    );
    const requireTaxCodeLast4 = Boolean(riskChallenge) && hasTaxCode;

    if (user.totp_enabled) {
      throw httpError(
        400,
        "Tài khoản đang dùng Google Authenticator, không có mã gửi qua email",
      );
    }

    await otpService.generateAndSaveOtp({ email: user.email });

    return {
      masked_email: maskEmail(user.email),
      otp_method: "email",
      require_tax_code_last4: requireTaxCodeLast4,
    };
  },

  async verifyTransactionOtp({
    userId,
    phone,
    otp,
    idempotencyKey,
    action,
    params,
    taxCodeLast4 = null,
    riskChallenge = false,
  }) {
    if (
      typeof idempotencyKey !== "string" ||
      !idempotencyKey ||
      idempotencyKey.length > 100
    ) {
      throw httpError(400, "Thiếu hoặc sai mã chống trùng lặp giao dịch");
    }
    // Tính trước khi kiểm tra OTP để dữ liệu sai không bị tính vào số lần nhập sai OTP.
    const binding = computePinBinding(action, params);

    const user = await getOtpMerchant({ userId, phone });

    const hasProvidedTaxCodeLast4 =
      taxCodeLast4 !== undefined && taxCodeLast4 !== null && taxCodeLast4 !== "";
    if (riskChallenge || hasProvidedTaxCodeLast4) {
      const expectedLast4 = user.tax_code
        ? String(user.tax_code).trim().slice(-4)
        : null;
      if (expectedLast4) {
        if (!taxCodeLast4 || !/^\d{4}$/.test(String(taxCodeLast4).trim())) {
          throw httpError(
            400,
            "Vui lòng nhập kèm 4 số cuối Mã số thuế để xác minh bảo mật",
          );
        }
        if (String(taxCodeLast4).trim() !== expectedLast4) {
          throw httpError(400, "4 số cuối Mã số thuế không chính xác");
        }
      }
    }

    if (user.totp_enabled) {
      await merchantAuthService.verifyEnabledTotp({
        userId: user.id,
        code: otp,
      });
    } else {
      await otpService.verifyOtp({ email: user.email, otp });
    }

    return {
      otp_token: tokenUtil.generateTransactionOtpToken({
        user,
        idempotencyKey,
        action,
        binding,
      }),
    };
  },

  // Tra tên người nhận theo số điện thoại trước khi chuyển tiền
  async getReceiverByPhone(userId, phone) {
    if (!phone) {
      throw httpError(400, "Thiếu số điện thoại người nhận");
    }

    if (!isValidPhone(phone)) {
      throw httpError(400, "Số điện thoại không hợp lệ");
    }

    const receiver = await merchantAuthRepository.findMerchantByPhone(phone);
    if (
      !receiver ||
      receiver.status !== "ACTIVE" ||
      receiver.role === "MERCHANT"
    ) {
      throw httpError(404, "Không tìm thấy người dùng nhận tiền");
    }

    if (receiver.id === userId) {
      throw httpError(400, "Không thể chuyển tiền cho chính mình");
    }

    return {
      user_id: receiver.id,
      full_name: receiver.full_name,
      phone: maskPhone(receiver.phone),
    };
  },

  async getTransactionLimits(userId, { role = "MERCHANT" } = {}) {
    return fetchTransactionLimits({
      userId,
      role,
      userRepository,
      includeSummary: true,
      getSummaryFn: getTransactionLimitsSummary,
    });
  },

  async updateTransactionLimit({
    userId,
    transactionType,
    maxAmount,
    dailyLimit,
    role = "MERCHANT",
  }) {
    return updateUserTransactionLimit({
      userId,
      transactionType,
      maxAmount,
      dailyLimit,
      role,
      userRepository,
      validateActiveRole: false,
      includeSummary: true,
      getSummaryFn: getTransactionLimitsSummary,
    });
  },

  async resetTransactionLimit({
    userId,
    transactionType,
    role = "MERCHANT",
  }) {
    return resetUserTransactionLimit({
      userId,
      transactionType,
      role,
      userRepository,
      validateActiveRole: false,
      includeSummary: true,
      getSummaryFn: getTransactionLimitsSummary,
    });
  },
};

module.exports = merchantTransactionService;
const merchantTransactionRepository = require("./transaction.repository");
const merchantAuthRepository = require("../auth/auth.repository");
const otpService = require("../../../../modules/otp/otp.service");
const tokenUtil = require("../../../../utils/jwt");
const { httpError } = require("../../../../utils/httpError");
const { maskEmail } = require("../../../../utils/maskPhoneAndEmail");
const { isValidPhone } = require("../../../../utils/validators");

const TRANSACTION_TYPES = [
  "TRANSFER",
  "TOPUP",
  "WITHDRAW",
  "PAYMENT",
  "REFUND",
  "REVERSAL",
];

// Giờ Việt Nam (UTC+7, không có DST) để so sánh giới hạn 1 năm theo ngày
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

function isValidDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const d = new Date(`${value}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function toNumberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function maskPhone(phone) {
  if (!phone) return null;
  return phone.length >= 3 ? `*********${phone.slice(-3)}` : phone;
}

function maskAccountNumber(accountNumber) {
  if (!accountNumber) return null;
  const str = String(accountNumber);
  return str.length > 4 ? `${"*".repeat(str.length - 4)}${str.slice(-4)}` : str;
}

// Lấy merchant đang đăng nhập (kèm email nhận OTP), giống getOtpMerchant bên auth.service
async function getOtpMerchant({ userId, phone }) {
  const user = phone ? await merchantAuthRepository.findMerchantByPhone(phone) : null;
  if (
    !user ||
    user.id !== userId ||
    user.status !== "ACTIVE" ||
    user.role !== "MERCHANT"
  ) {
    throw httpError(401, "Phiên xác thực không hợp lệ");
  }

  if (!user.email) {
    throw httpError(404, "Không tìm thấy email liên kết với số điện thoại");
  }

  return user;
}

const merchantTransactionService = {
  async transferMoney({
    sourceUserId,
    destinationUserId,
    amount,
    description,
    idempotencyKey,
  }) {
    if (!sourceUserId || !destinationUserId) {
      throw httpError(400, "Thiếu thông tin người gửi hoặc người nhận");
    }

    if (sourceUserId === destinationUserId) {
      throw httpError(400, "Không thể chuyển tiền cho chính mình");
    }

    const numAmount = Number(amount);
    if (
      !Number.isInteger(numAmount) ||
      numAmount < 1000 ||
      numAmount > 50000000
    ) {
      throw httpError(400, "Số tiền chuyển phải từ 1 nghìn và tối đa là 50 triệu");
    }

    return await merchantTransactionRepository.transferMoney({
      sourceUserId,
      destinationUserId,
      amount: numAmount,
      fee: 0,
      description,
      idempotencyKey,
      transactionType: "TRANSFER",
      status: "SUCCESS",
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

    const numAmount = Number(amount);
    if (
      !Number.isInteger(numAmount) ||
      numAmount < 1000 ||
      numAmount > 50000000
    ) {
      throw httpError(400, "Số tiền nạp phải từ 1 nghìn và tối đa là 50 triệu");
    }
    if (!linkedBankAccountId) {
      throw httpError(400, "Thiếu thông tin ngân hàng liên kết");
    }

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

  async withdrawnMoney({
    sourceUserId,
    amount,
    idempotencyKey,
    linkedBankAccountId,
  }) {
    if (!sourceUserId) {
      throw httpError(400, "Thiếu thông tin người thực hiện giao dịch");
    }

    const numAmount = Number(amount);
    if (
      !Number.isInteger(numAmount) ||
      numAmount < 10000 ||
      numAmount > 50000000
    ) {
      throw httpError(400, "Số tiền rút phải từ 10 nghìn và tối đa là 50 triệu");
    }
    if (!linkedBankAccountId) {
      throw httpError(400, "Thiếu thông tin ngân hàng liên kết");
    }

    return await merchantTransactionRepository.withdrawnMoney({
      sourceUserId,
      amount: numAmount,
      fee: 0,
      idempotencyKey,
      transactionType: "WITHDRAW",
      status: "SUCCESS",
      linkedBankAccountId: linkedBankAccountId,
    });
  },

  async processQRPayment({ sourceUserId, idempotencyKey, referenceCode }) {
    if (!sourceUserId) {
      throw httpError(400, "Thiếu thông tin người gửi");
    }

    if (!referenceCode) {
      throw httpError(400, "Thiếu thông tin của mã QR");
    }

    return await merchantTransactionRepository.processQRPayment({
      sourceUserId,
      idempotencyKey,
      referenceCode,
      transactionType: "PAYMENT",
      status: "SUCCESS",
    });
  },

  async getTransferHistory(
    userId,
    { cursorId, limit, keyword, type, startDate, endDate },
  ) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin để lấy lịch sử giao dịch");
    }

    const maxLimit = Math.min(Number(limit) || 20, 20);

    const normalizedKeyword = keyword && keyword.trim() ? keyword.trim() : null;

    const normalizedType =
      type && String(type).trim() ? String(type).trim().toUpperCase() : null;
    if (normalizedType && !TRANSACTION_TYPES.includes(normalizedType)) {
      throw httpError(400, "Loại giao dịch không hợp lệ");
    }

    // Ngày được giữ dạng chuỗi YYYY-MM-DD, repository sẽ tính theo giờ Việt Nam
    let startDay = null;
    let endDay = null;

    if (startDate) {
      if (!isValidDateOnly(startDate)) {
        throw httpError(400, "Ngày bắt đầu không hợp lệ");
      }
      startDay = startDate;
    }

    if (endDate) {
      if (!isValidDateOnly(endDate)) {
        throw httpError(400, "Ngày kết thúc không hợp lệ");
      }
      endDay = endDate;
    }

    if (startDay && endDay && startDay > endDay) {
      throw httpError(400, "Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc");
    }
    if (startDay) {
      const oneYearAgo = new Date(Date.now() + VN_OFFSET_MS);
      oneYearAgo.setUTCFullYear(oneYearAgo.getUTCFullYear() - 1);
      if (startDay < oneYearAgo.toISOString().slice(0, 10)) {
        throw httpError(
          400,
          "Chỉ có thể xem lịch sử giao dịch trong vòng 1 năm gần nhất",
        );
      }
    }

    const result = await merchantTransactionRepository.getTransferHistory(userId, {
      cursorId,
      limit: maxLimit,
      keyword: normalizedKeyword,
      type: normalizedType,
      startDate: startDay,
      endDate: endDay,
    });

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

    const detail = {
      id: row.id,
      transaction_type: type,
      status: row.status,
      direction: row.direction,
      amount: Number(row.amount),
      fee: Number(row.fee),
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

    if (isBankType) {
      detail.bank = row.bank_name
        ? {
            bank_name: row.bank_name,
            bank_code: row.bank_code,
            logo_url: row.bank_logo_url,
            account_holder_name: row.account_holder_name,
            account_number: maskAccountNumber(row.account_number),
          }
        : null;
    } else {
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

    const result = await merchantTransactionRepository.getCurrentMonthSummary(userId);

    return {
      total_expense: result.total_expense,
      total_income: result.total_income,
    };
  },

  async getMerchantStats(userId, { startDate, endDate }) {
    if (!userId) {
      throw httpError(400, "Thiếu thông tin người dùng");
    }

    let startDay = null;
    let endDay = null;

    if (startDate) {
      if (!isValidDateOnly(startDate)) {
        throw httpError(400, "Ngày bắt đầu không hợp lệ");
      }
      startDay = startDate;
    }

    if (endDate) {
      if (!isValidDateOnly(endDate)) {
        throw httpError(400, "Ngày kết thúc không hợp lệ");
      }
      endDay = endDate;
    }

    if (startDay && endDay && startDay > endDay) {
      throw httpError(400, "Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc");
    }

    const data = await merchantTransactionRepository.getMerchantStats(userId, {
      startDate: startDay,
      endDate: endDay,
    });

    return {
      total_revenue: Number(data.summary.total_revenue),
      total_orders: Number(data.summary.total_orders),
      avg_order_value: Number(data.summary.avg_order_value),
      daily_stats: data.daily_stats.map(row => ({
        date: row.date_str,
        revenue: Number(row.revenue),
        order_count: Number(row.order_count)
      }))
    };
  },

  // Gửi OTP xác thực giao dịch (nếu OTP cũ còn hiệu lực thì dùng tiếp, giống login)
  async sendTransactionOtp({ userId, phone }) {
    const user = await getOtpMerchant({ userId, phone });

    try {
      await otpService.generateAndSaveOtp({ email: user.email });
    } catch (e) {
      if (e.statusCode !== 429) throw e;
    }

    return { masked_email: maskEmail(user.email) };
  },

  async resendTransactionOtp({ userId, phone }) {
    const user = await getOtpMerchant({ userId, phone });

    await otpService.generateAndSaveOtp({ email: user.email });

    return { masked_email: maskEmail(user.email) };
  },

  // OTP đúng thì trả về otp_token (purpose: transaction_otp), giống verifyLoginOtp
  async verifyTransactionOtp({ userId, phone, otp, idempotencyKey }) {
    if (
      typeof idempotencyKey !== "string" ||
      !idempotencyKey ||
      idempotencyKey.length > 100
    ) {
      throw httpError(400, "Thiếu hoặc sai idempotency key của giao dịch");
    }

    const user = await getOtpMerchant({ userId, phone });

    await otpService.verifyOtp({ email: user.email, otp });

    return {
      otp_token: tokenUtil.generateTransactionOtpToken({ user, idempotencyKey }),
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
    if (!receiver || receiver.status !== "ACTIVE" || receiver.role === "MERCHANT") {
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
};

module.exports = merchantTransactionService;
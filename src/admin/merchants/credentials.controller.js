// credentials.controller.js: Controller xem, xoay/thu hồi/cấp lại khóa tích hợp Merchant và lịch sử thay đổi Admin.
const credentials = require("../../modules/merchant/shared/credentials");
const adminCredentialsRepository = require("./credentials.repository");
const { httpError, successResponse, extractRawBody } = require("../../utils/common/http");
const { UUID_REGEX } = require("../../utils/common/validators");
const { assertValidReason } = require("../shared/adminHelpers");
const { CREDENTIAL_AUDIT_ACTIONS } = require("./merchants.helpers");

const adminCredentialsController = {
  validateMerchantParam(req, res, next) {
    res.set("Cache-Control", "no-store");
    if (!UUID_REGEX.test(req.params.id)) {
      return next(httpError(400, "Định danh Merchant không hợp lệ"));
    }
    return next();
  },

  async getCredentials(req, res, next) {
    try {
      const row = await adminCredentialsRepository.getMerchantCredentialsRow(
        req.params.id,
      );
      if (!row) throw httpError(404, "Không tìm thấy Merchant");
      return successResponse(
        res,
        200,
        "Thông tin khóa tích hợp",
        credentials.metadata(row),
      );
    } catch (e) {
      return next(e);
    }
  },

  async mutateCredential(req, res, next, operation) {
    try {
      const body = extractRawBody(req);
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).some(
          (k) => !["reason", "expected_revision"].includes(k),
        )
      ) {
        throw httpError(400, "Dữ liệu không hợp lệ");
      }
      const cleanReason = assertValidReason(body.reason, {
        min: 5,
        max: 500,
        requiredMessage: "Lý do phải từ 5 đến 500 ký tự",
        lengthMessage: "Lý do phải từ 5 đến 500 ký tự",
      });
      if (
        !/^(0|[1-9][0-9]{0,17})$/.test(String(body.expected_revision ?? ""))
      ) {
        throw httpError(
          400,
          "Thiếu hoặc sai phiên bản khóa (expected_revision)",
        );
      }
      const result = await credentials.mutate({
        merchantId: req.params.id,
        operation,
        expectedRevision: body.expected_revision,
        adminId: req.user.user_id,
        reason: cleanReason,
      });
      return successResponse(
        res,
        200,
        "Cập nhật khóa tích hợp thành công",
        result,
      );
    } catch (e) {
      return next(e);
    }
  },

  async history(req, res, next) {
    try {
      if (!UUID_REGEX.test(req.params.id)) {
        throw httpError(400, "Định danh Merchant không hợp lệ");
      }
      const exists = await adminCredentialsRepository.merchantExists(
        req.params.id,
      );
      if (!exists) throw httpError(404, "Không tìm thấy Merchant");

      const page = String(req.query.page ?? "1");
      const limit = String(req.query.limit ?? "10");
      if (
        !/^[1-9][0-9]{0,6}$/.test(page) ||
        !/^[1-9][0-9]{0,2}$/.test(limit) ||
        Number(limit) > 100
      ) {
        throw httpError(400, "Phân trang không hợp lệ");
      }

      const action = req.query.action ?? null;
      if (action !== null && !CREDENTIAL_AUDIT_ACTIONS.includes(action)) {
        throw httpError(400, "Loại thao tác không hợp lệ");
      }

      const pageNum = Number(page);
      const limitNum = Number(limit);
      const { total, items } =
        await adminCredentialsRepository.getCredentialsHistory({
          merchantId: req.params.id,
          actions: CREDENTIAL_AUDIT_ACTIONS,
          action,
          limit: limitNum,
          offset: (pageNum - 1) * limitNum,
        });

      res.set("Cache-Control", "no-store");
      return successResponse(res, 200, "Lịch sử khóa tích hợp", {
        items,
        pagination: {
          total_items: total,
          current_page: pageNum,
          limit: limitNum,
          total_pages: Math.ceil(total / limitNum),
        },
      });
    } catch (e) {
      return next(e);
    }
  },
};

module.exports = adminCredentialsController;

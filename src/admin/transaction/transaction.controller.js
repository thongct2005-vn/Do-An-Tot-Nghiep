const { successResponse } = require("../../utils/apiResponse");
const adminTransactionService = require("./transaction.service");
const { sendXlsxResponse } = require("./transaction.export");

const adminTransactionController = {
  async exportTransactions(req, res, next) {
    try {
      const {
        type,
        status,
        initiated_by,
        anomaly,
        keyword,
        period,
        start_date,
        end_date,
      } = req.query;

      const { buffer, fileName } =
        await adminTransactionService.exportTransactions({
          type,
          status,
          initiated_by,
          anomaly,
          keyword,
          period,
          start_date,
          end_date,
          currentUser: req.user,
        });

      return sendXlsxResponse(res, { buffer, fileName });
    } catch (e) {
      next(e);
    }
  },

  async getTransactions(req, res, next) {
    try {
      const {
        page,
        limit,
        type,
        status,
        initiated_by,
        anomaly,
        keyword,
        period,
        start_date,
        end_date,
      } = req.query;

      const result = await adminTransactionService.getTransactions({
        page,
        limit,
        type,
        status,
        initiated_by,
        anomaly,
        keyword,
        period,
        start_date,
        end_date,
      });

      return successResponse(
        res,
        200,
        "Lấy danh sách giao dịch thành công",
        result
      );
    } catch (e) {
      next(e);
    }
  },

  async getTransactionDetail(req, res, next) {
    try {
      const { id } = req.params;
      const result = await adminTransactionService.getTransactionDetail(id);

      return successResponse(
        res,
        200,
        "Lấy chi tiết giao dịch thành công",
        result
      );
    } catch (e) {
      next(e);
    }
  },

  async openDispute(req, res, next) {
    try {
      const { id } = req.params;
      const {
        dispute_type,
        disputeType,
        reason,
        authorization_reference,
        authorizationReference,
        note,
      } = req.body;

      const result = await adminTransactionService.openDispute(id, {
        disputeType: dispute_type || disputeType,
        reason,
        authorizationReference:
          authorization_reference || authorizationReference,
        note,
        currentUser: req.user,
      });

      return successResponse(
        res,
        201,
        "Mở hồ sơ tra soát thành công",
        result
      );
    } catch (e) {
      next(e);
    }
  },

  async appendDisputeEvent(req, res, next) {
    try {
      const { id, disputeId } = req.params;
      const {
        action,
        dispute_status,
        disputeStatus,
        resolution_result,
        resolutionResult,
        reason,
        note,
      } = req.body;

      const result = await adminTransactionService.appendDisputeEvent(
        id,
        disputeId,
        {
          action,
          disputeStatus: dispute_status || disputeStatus,
          resolutionResult: resolution_result || resolutionResult,
          reason,
          note,
          currentUser: req.user,
        }
      );

      return successResponse(
        res,
        200,
        "Cập nhật hồ sơ tra soát thành công",
        result
      );
    } catch (e) {
      next(e);
    }
  },
};

module.exports = adminTransactionController;


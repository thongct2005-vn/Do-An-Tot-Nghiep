const { errorResponse } = require("../utils/apiResponse");
require("dotenv").config();

const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || "Lỗi không xác định";
  let errorDetail = null;
  
  if (err.statusCode === 500) {
    console.log(err.stack);
  } else {
    console.log(
      `[${statusCode}] ${req.method} ${req.originalUrl} - ${message}`,
    );
  }

  if (err.code === "23505") {
    statusCode = 400;
    message = "Dữ liệu đã tồn tại";
  }

  const environment = process.env.NODE_ENV || "";

  if (environment === "development") {
    errorDetail = err.stack;
  } else {
    if (statusCode === 500) {
      message = "Hệ thống đang bảo trì!";
    }
  }

  return errorResponse(res, statusCode, message, errorDetail);
};

module.exports = errorHandler;

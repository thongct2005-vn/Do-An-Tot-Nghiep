// src/middlewares/upload.middleware.js
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { httpError } = require("../utils/common/http");

const KYC_ROOT = path.join(process.cwd(), "private", "kyc");
const POSTPAID_PROOF_ROOT = path.join(process.cwd(), "private", "postpaid-proof");

const folders = {
  front_id: path.join(KYC_ROOT, "front-id"),
  back_id: path.join(KYC_ROOT, "back-id"),
  face: path.join(KYC_ROOT, "face"),
};

Object.values(folders).forEach((dir) => {
  fs.mkdirSync(dir, { recursive: true });
});
fs.mkdirSync(POSTPAID_PROOF_ROOT, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = folders[file.fieldname];
    if (!dir) return cb(new Error("Tên trường tải lên không hợp lệ"), null);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const userId = req.user?.user_id ?? req.forgotUser?.user_id;
    if (!userId) return cb(new Error("Thiếu thông tin người dùng"), null);
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    cb(null, `${userId}_${Date.now()}${ext}`);
  },
});

const postpaidProofStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(POSTPAID_PROOF_ROOT, { recursive: true });
    cb(null, POSTPAID_PROOF_ROOT);
  },
  filename: (req, file, cb) => {
    const userId = req.user?.user_id;
    if (!userId) return cb(new Error("Thiếu thông tin người dùng"), null);
    const rawExt = path.extname(file.originalname || "").toLowerCase();
    const ext = [".jpg", ".jpeg", ".png"].includes(rawExt) ? rawExt : ".jpg";
    const seq = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    cb(null, `${userId}_${seq}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ["image/jpeg", "image/png", "image/jpg"];
  if (!allowedTypes.includes(file.mimetype)) {
    return cb(new Error("Chỉ chấp nhận file ảnh JPEG/PNG"), false);
  }
  cb(null, true);
};

const uploadKycImages = multer({
  storage,
  fileFilter,
  limits: { fileSize: 8 * 1024 * 1024 },
}).fields([
  { name: "front_id", maxCount: 1 },
  { name: "back_id", maxCount: 1 },
  { name: "face", maxCount: 1 },
]);

const postpaidProofUpload = multer({
  storage: postpaidProofStorage,
  fileFilter,
  limits: { fileSize: 8 * 1024 * 1024, files: 3 },
}).array("proof_images", 3);

function uploadPostpaidProofImages(req, res, next) {
  postpaidProofUpload(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return next(httpError(400, "Mỗi ảnh chứng minh thu nhập không được vượt quá 8MB"));
    }
    if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
      return next(httpError(400, "Chỉ được tải lên tối đa 3 ảnh chứng minh thu nhập ở trường proof_images"));
    }
    return next(httpError(400, err.message || "Tệp ảnh chứng minh thu nhập không hợp lệ"));
  });
}

module.exports = {
  uploadKycImages,
  uploadPostpaidProofImages,
  KYC_ROOT,
  POSTPAID_PROOF_ROOT,
};

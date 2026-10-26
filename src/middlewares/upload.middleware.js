// src/middlewares/upload.middleware.js
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const KYC_ROOT = path.join(process.cwd(), "private", "kyc");

const folders = {
  front_id: path.join(KYC_ROOT, "front-id"),
  back_id: path.join(KYC_ROOT, "back-id"),
  face: path.join(KYC_ROOT, "face"),
};

Object.values(folders).forEach((dir) => {
  fs.mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = folders[file.fieldname];
    if (!dir) return cb(new Error("Field name không hợp lệ"), null);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const userId = req.user?.user_id ?? req.forgotUser?.user_id;
    if (!userId) return cb(new Error("Thiếu thông tin người dùng"), null);
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    cb(null, `${userId}_${Date.now()}${ext}`);
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

module.exports = { uploadKycImages, KYC_ROOT };
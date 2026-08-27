// src/middlewares/upload.middleware.js
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const IMAGES_ROOT = path.join(process.cwd(), "images");

const folders = {
  front_id: path.join(IMAGES_ROOT, "front-id"),
  back_id: path.join(IMAGES_ROOT, "back-id"),
  face: path.join(IMAGES_ROOT, "face"),
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
    const userId = req.user.user_id;
    const ext = path.extname(file.originalname);
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
  limits: { fileSize: 8 * 1024 * 1024 },// byte=>KB=>MB
}).fields([
  { name: "front_id", maxCount: 1 },
  { name: "back_id", maxCount: 1 },
  { name: "face", maxCount: 1 },
]);

module.exports = { uploadKycImages };
// imageStorage.js: Tiện ích lưu trữ, xác thực đường dẫn an toàn, trả tệp ảnh riêng tư (KYC / Postpaid) và dọn dẹp tệp tạm.
const fs = require("fs");
const path = require("path");
const {
  KYC_ROOT,
  POSTPAID_PROOF_ROOT,
} = require("../../middlewares/upload.middleware");
const { httpError } = require("../common/http");

const KYC_IMAGE_SIDES = Object.freeze({
  front: { column: "front_image_url", subdir: "front-id", routeSide: "front" },
  front_id: { column: "front_image_url", subdir: "front-id", routeSide: "front" },
  back: { column: "back_image_url", subdir: "back-id", routeSide: "back" },
  back_id: { column: "back_image_url", subdir: "back-id", routeSide: "back" },
  face: { column: "face_image_url", subdir: "face", routeSide: "face" },
});

function resolveKycSideSpec(side) {
  const key = String(side ?? "").trim().toLowerCase();
  const spec = KYC_IMAGE_SIDES[key];
  if (!spec) {
    throw httpError(400, "Loại ảnh KYC không hợp lệ");
  }
  return spec;
}

function resolveRequestBase(req, defaultPrefix) {
  const prefix = String(req?.baseUrl || defaultPrefix || "").replace(/\/+$/, "");
  if (!req) {
    return { origin: "", routePrefix: prefix };
  }
  const host =
    typeof req.get === "function" ? req.get("host") : req.headers?.host;
  if (!host) {
    return { origin: "", routePrefix: prefix };
  }
  const proto = req.protocol || "http";
  return { origin: `${proto}://${host}`, routePrefix: prefix };
}

function buildAdminKycImageUrl({
  storedValue,
  origin = "",
  routePrefix,
  entityId,
  side,
}) {
  if (!storedValue || typeof storedValue !== "string") return null;
  const trimmed = storedValue.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  const spec = resolveKycSideSpec(side);
  return `${origin}${routePrefix}/${encodeURIComponent(String(entityId))}/kyc/${spec.routeSide}`;
}

/**
 * Kiểm tra đường dẫn/tên tệp ảnh nằm an toàn bên trong thư mục gốc và là tệp hợp lệ trên đĩa.
 */
async function resolveSafeStoredFilePath({
  storedPath,
  targetDir,
  requireExactBasename = false,
  missingMessage,
  invalidMessage,
  notFoundMessage,
}) {
  if (!storedPath || typeof storedPath !== "string" || !storedPath.trim()) {
    throw httpError(404, missingMessage);
  }

  const trimmed = storedPath.trim();
  if (trimmed.includes("\0")) {
    throw httpError(400, invalidMessage);
  }

  // Hỗ trợ cả đường dẫn Windows (\) và Linux (/) đã lưu trước đó trong DB
  const fileName = path.win32.basename(trimmed);
  if (
    !fileName ||
    fileName === "." ||
    fileName === ".." ||
    (requireExactBasename && fileName !== trimmed) ||
    fileName.includes("/") ||
    fileName.includes("\\")
  ) {
    throw httpError(400, invalidMessage);
  }

  const resolvedDir = path.resolve(targetDir);
  const absolutePath = path.resolve(resolvedDir, fileName);
  if (!absolutePath.startsWith(`${resolvedDir}${path.sep}`)) {
    throw httpError(400, invalidMessage);
  }

  let stat;
  try {
    stat = await fs.promises.stat(absolutePath);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      throw httpError(404, notFoundMessage);
    }
    throw err;
  }

  if (!stat.isFile()) {
    throw httpError(404, notFoundMessage);
  }

  return absolutePath;
}

/**
 * Gửi tệp riêng tư với header không lưu cache và ánh xạ lỗi ENOENT/404 thống nhất.
 */
function sendPrivateFile({ res, next, filePath, notFoundMessage }) {
  res.set("Cache-Control", "private, no-store");
  res.sendFile(filePath, { dotfiles: "deny" }, (err) => {
    if (!err || res.headersSent) return;
    if (err.statusCode === 404 || err.code === "ENOENT") {
      return next(httpError(404, notFoundMessage));
    }
    return next(err);
  });
}

async function resolveSafeKycFilePath({ storedPath, side, rootDir = KYC_ROOT }) {
  const spec = resolveKycSideSpec(side);
  return resolveSafeStoredFilePath({
    storedPath,
    targetDir: path.resolve(rootDir, spec.subdir),
    requireExactBasename: false,
    missingMessage: "Không tìm thấy ảnh KYC",
    invalidMessage: "Đường dẫn ảnh KYC không hợp lệ",
    notFoundMessage: "Không tìm thấy tệp ảnh KYC",
  });
}

function sendKycImageFile({ res, next, filePath }) {
  return sendPrivateFile({
    res,
    next,
    filePath,
    notFoundMessage: "Không tìm thấy tệp ảnh KYC",
  });
}

async function removeUploadedProofFiles(files = []) {
  for (const file of Array.isArray(files) ? files : []) {
    if (!file || !file.path) continue;
    try {
      await fs.promises.unlink(file.path);
    } catch (_) {}
  }
}

async function resolveSafePostpaidProofPath({
  storedName,
  rootDir = POSTPAID_PROOF_ROOT,
}) {
  return resolveSafeStoredFilePath({
    storedPath: storedName,
    targetDir: rootDir,
    requireExactBasename: true,
    missingMessage: "Không tìm thấy ảnh chứng minh thu nhập",
    invalidMessage: "Đường dẫn ảnh chứng minh thu nhập không hợp lệ",
    notFoundMessage: "Không tìm thấy tệp ảnh chứng minh thu nhập",
  });
}

function sendPostpaidProofImageFile({ res, next, filePath }) {
  return sendPrivateFile({
    res,
    next,
    filePath,
    notFoundMessage: "Không tìm thấy tệp ảnh chứng minh thu nhập",
  });
}

/**
 * Xóa an toàn danh sách đường dẫn file tạm trên đĩa (bỏ qua file không tồn tại).
 */
function removeTempFiles(paths) {
  for (const p of paths) {
    if (p && fs.existsSync(p)) {
      fs.unlinkSync(p);
    }
  }
}

module.exports = {
  KYC_IMAGE_SIDES,
  resolveKycSideSpec,
  resolveRequestBase,
  buildAdminKycImageUrl,
  resolveSafeKycFilePath,
  sendKycImageFile,
  removeUploadedProofFiles,
  resolveSafePostpaidProofPath,
  sendPostpaidProofImageFile,
  removeTempFiles,
};


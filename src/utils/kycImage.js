const fs = require("fs");
const path = require("path");
const { KYC_ROOT } = require("../middlewares/upload.middleware");
const { httpError } = require("./httpError");

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

async function resolveSafeKycFilePath({ storedPath, side, rootDir = KYC_ROOT }) {
  const spec = resolveKycSideSpec(side);
  if (!storedPath || typeof storedPath !== "string" || !storedPath.trim()) {
    throw httpError(404, "Không tìm thấy ảnh KYC");
  }

  const trimmed = storedPath.trim();
  if (trimmed.includes("\0")) {
    throw httpError(400, "Đường dẫn ảnh KYC không hợp lệ");
  }

  // Hỗ trợ cả đường dẫn Windows (\) và Linux (/) đã lưu trước đó trong DB
  const fileName = path.win32.basename(trimmed);
  if (
    !fileName ||
    fileName === "." ||
    fileName === ".." ||
    fileName.includes("/") ||
    fileName.includes("\\")
  ) {
    throw httpError(400, "Đường dẫn ảnh KYC không hợp lệ");
  }

  const targetDir = path.resolve(rootDir, spec.subdir);
  const absolutePath = path.resolve(targetDir, fileName);
  if (!absolutePath.startsWith(`${targetDir}${path.sep}`)) {
    throw httpError(400, "Đường dẫn ảnh KYC không hợp lệ");
  }

  let stat;
  try {
    stat = await fs.promises.stat(absolutePath);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      throw httpError(404, "Không tìm thấy tệp ảnh KYC");
    }
    throw err;
  }

  if (!stat.isFile()) {
    throw httpError(404, "Không tìm thấy tệp ảnh KYC");
  }

  return absolutePath;
}

function sendKycImageFile({ res, next, filePath }) {
  res.set("Cache-Control", "private, no-store");
  res.sendFile(filePath, { dotfiles: "deny" }, (err) => {
    if (!err || res.headersSent) return;
    if (err.statusCode === 404 || err.code === "ENOENT") {
      return next(httpError(404, "Không tìm thấy tệp ảnh KYC"));
    }
    return next(err);
  });
}

module.exports = {
  KYC_IMAGE_SIDES,
  resolveKycSideSpec,
  resolveRequestBase,
  buildAdminKycImageUrl,
  resolveSafeKycFilePath,
  sendKycImageFile,
};


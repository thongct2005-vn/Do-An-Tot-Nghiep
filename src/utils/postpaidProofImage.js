const fs = require("fs");
const path = require("path");
const { POSTPAID_PROOF_ROOT } = require("../middlewares/upload.middleware");
const { httpError } = require("./httpError");

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
  if (!storedName || typeof storedName !== "string" || !storedName.trim()) {
    throw httpError(404, "Không tìm thấy ảnh chứng minh thu nhập");
  }

  const trimmed = storedName.trim();
  if (trimmed.includes("\0")) {
    throw httpError(400, "Đường dẫn ảnh chứng minh thu nhập không hợp lệ");
  }

  const fileName = path.win32.basename(trimmed);
  if (
    !fileName ||
    fileName === "." ||
    fileName === ".." ||
    fileName !== trimmed ||
    fileName.includes("/") ||
    fileName.includes("\\")
  ) {
    throw httpError(400, "Đường dẫn ảnh chứng minh thu nhập không hợp lệ");
  }

  const targetDir = path.resolve(rootDir);
  const absolutePath = path.resolve(targetDir, fileName);
  if (!absolutePath.startsWith(`${targetDir}${path.sep}`)) {
    throw httpError(400, "Đường dẫn ảnh chứng minh thu nhập không hợp lệ");
  }

  let stat;
  try {
    stat = await fs.promises.stat(absolutePath);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      throw httpError(404, "Không tìm thấy tệp ảnh chứng minh thu nhập");
    }
    throw err;
  }

  if (!stat.isFile()) {
    throw httpError(404, "Không tìm thấy tệp ảnh chứng minh thu nhập");
  }

  return absolutePath;
}

function sendPostpaidProofImageFile({ res, next, filePath }) {
  res.set("Cache-Control", "private, no-store");
  res.sendFile(filePath, { dotfiles: "deny" }, (err) => {
    if (!err) return;
    if (res.headersSent) return;
    if (err.code === "ENOENT" || err.statusCode === 404) {
      return next(httpError(404, "Không tìm thấy tệp ảnh chứng minh thu nhập"));
    }
    return next(err);
  });
}

module.exports = {
  removeUploadedProofFiles,
  resolveSafePostpaidProofPath,
  sendPostpaidProofImageFile,
};

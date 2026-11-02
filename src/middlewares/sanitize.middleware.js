const {
  stripControlChars,
  sanitizeText,
  sanitizeSearch,
  sanitizePhone,
  sanitizeEmail,
} = require("../utils/sanitize");

// Lọc theo tên field, áp dụng cho mọi route (body + query).
// Thêm field mới ở đây là tất cả API nhận field đó đều được lọc.
const FIELD_RULES = {
  phone: sanitizePhone,
  email: sanitizeEmail,
  keyword: (v) => sanitizeSearch(v),
  search: (v) => sanitizeSearch(v),
  description: (v) => sanitizeText(v, { maxLength: 255 }),
};

// Key nguy hiểm dùng để tấn công prototype pollution
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_DEPTH = 6;

function clean(node, depth = 0) {
  if (depth > MAX_DEPTH || node === null || typeof node !== "object") {
    return node;
  }

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      node[i] =
        typeof node[i] === "string"
          ? stripControlChars(node[i])
          : clean(node[i], depth + 1);
    }
    return node;
  }

  for (const key of Object.keys(node)) {
    if (DANGEROUS_KEYS.has(key)) {
      delete node[key];
      continue;
    }
    const value = node[key];
    const rule = FIELD_RULES[key];
    if (rule) {
      node[key] = rule(value);
    } else if (typeof value === "string") {
      // Field khác (mật khẩu, PIN, token...): chỉ bỏ ký tự điều khiển, không đổi nội dung
      node[key] = stripControlChars(value);
    } else {
      node[key] = clean(value, depth + 1);
    }
  }
  return node;
}

function sanitizeRequest(req, res, next) {
  if (req.body && typeof req.body === "object") {
    req.body = clean(req.body);
  }

  // Express 5: req.query là getter, parse lại mỗi lần đọc nên phải gán đè thành giá trị cố định
  if (req.query && typeof req.query === "object") {
    const query = clean({ ...req.query });
    Object.defineProperty(req, "query", {
      value: query,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
  next();
}

module.exports = sanitizeRequest;
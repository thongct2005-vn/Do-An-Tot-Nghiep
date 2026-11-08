// ============================================================================
// Middleware làm sạch (sanitize) dữ liệu đầu vào của request
// ----------------------------------------------------------------------------
// Mục đích: chạy trước mọi route để chuẩn hóa/lọc dữ liệu client gửi lên
// (req.body và req.query), giảm rủi ro như:
//   - Ký tự điều khiển (null byte, \x00-\x1F...) làm hỏng dữ liệu / log / DB
//   - Prototype pollution (__proto__, constructor, prototype)
//   - Chuỗi quá dài hoặc định dạng sai ở các field nhạy cảm (phone, email...)
// Lưu ý: đây là lớp lọc chung, KHÔNG thay thế việc validate chặt chẽ
// (schema validation) và dùng query tham số hóa ở tầng DB.
// ============================================================================
const {
  stripControlChars, // Bỏ ký tự điều khiển, giữ nguyên phần nội dung còn lại
  sanitizeText,      // Làm sạch văn bản thông thường (có thể giới hạn độ dài)
  sanitizeSearch,    // Làm sạch chuỗi tìm kiếm
  sanitizePhone,     // Chuẩn hóa/lọc số điện thoại
  sanitizeEmail,     // Chuẩn hóa/lọc email
} = require("../utils/sanitize");

// ----------------------------------------------------------------------------
// FIELD_RULES: bảng ánh xạ "tên field" -> "hàm làm sạch riêng cho field đó".
// - Áp dụng cho mọi route, cả body lẫn query, ở bất kỳ độ sâu nào (trong giới
//   hạn MAX_DEPTH), miễn là tên key khớp.
// - Muốn thêm field mới cần lọc: chỉ cần thêm 1 dòng vào đây, tất cả API nhận
//   field đó sẽ tự động được lọc mà không phải sửa từng controller.
// ----------------------------------------------------------------------------
const FIELD_RULES = {
  phone: sanitizePhone,
  email: sanitizeEmail,
  // Bọc trong arrow function để chỉ truyền đúng 1 tham số (value),
  // tránh việc các tham số phụ bị truyền nhầm vào hàm sanitize.
  keyword: (v) => sanitizeSearch(v),
  search: (v) => sanitizeSearch(v),
  // Mô tả: làm sạch văn bản và cắt tối đa 255 ký tự
  description: (v) => sanitizeText(v, { maxLength: 255 }),
};

// ----------------------------------------------------------------------------
// Các key nguy hiểm dùng để tấn công prototype pollution.
// Nếu attacker gửi JSON như {"__proto__": {"isAdmin": true}}, việc merge/gán
// đối tượng sau này có thể làm "nhiễm" Object.prototype, ảnh hưởng toàn bộ app.
// Vì vậy ta xóa thẳng các key này khỏi dữ liệu đầu vào.
// Dùng Set để tra cứu nhanh O(1).
// ----------------------------------------------------------------------------
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// Giới hạn độ sâu đệ quy khi duyệt object lồng nhau.
// Mục đích: chống payload lồng cực sâu gây tốn CPU hoặc tràn stack (DoS).
// Phần vượt quá độ sâu này được trả về nguyên trạng (không xử lý thêm).
const MAX_DEPTH = 6;

// ----------------------------------------------------------------------------
// clean(node, depth): duyệt đệ quy một object/array và làm sạch tại chỗ
// (mutate trực tiếp), rồi trả về chính node đó.
//   - node : giá trị cần làm sạch (object, array hoặc giá trị nguyên thủy)
//   - depth: độ sâu hiện tại, bắt đầu từ 0
// ----------------------------------------------------------------------------
function clean(node, depth = 0) {
  // Điều kiện dừng đệ quy: trả về nguyên giá trị khi
  //   - đã vượt quá độ sâu cho phép, hoặc
  //   - là null, hoặc
  //   - không phải object (string/number/boolean... xử lý ở tầng gọi).
  if (depth > MAX_DEPTH || node === null || typeof node !== "object") {
    return node;
  }

  // Trường hợp node là mảng: không có "tên field" nên không áp dụng FIELD_RULES.
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      // Phần tử là chuỗi -> chỉ bỏ ký tự điều khiển.
      // Phần tử là object/array -> đệ quy xuống sâu hơn (depth + 1).
      node[i] =
        typeof node[i] === "string"
          ? stripControlChars(node[i])
          : clean(node[i], depth + 1);
    }
    return node;
  }

  // Trường hợp node là object thường: duyệt từng key của chính nó.
  // Object.keys chỉ lấy key sở hữu (own, enumerable), không lấy key kế thừa.
  for (const key of Object.keys(node)) {
    // 1) Chặn prototype pollution: gặp key nguy hiểm thì xóa và bỏ qua.
    if (DANGEROUS_KEYS.has(key)) {
      delete node[key];
      continue;
    }

    const value = node[key];
    // 2) Tra xem field này có rule riêng không (phone, email, keyword...).
    const rule = FIELD_RULES[key];

    if (rule) {
      // Có rule riêng -> áp dụng hàm làm sạch chuyên biệt cho field đó.
      node[key] = rule(value);
    } else if (typeof value === "string") {
      // Field khác (mật khẩu, PIN, token...): chỉ bỏ ký tự điều khiển,
      // TUYỆT ĐỐI không đổi nội dung (trim, escape, cắt ngắn...) vì làm vậy
      // có thể khiến mật khẩu/PIN/token bị sai so với giá trị gốc.
      node[key] = stripControlChars(value);
    } else {
      // Giá trị là object/array/number/... -> đệ quy xuống cấp sâu hơn.
      node[key] = clean(value, depth + 1);
    }
  }
  return node;
}

// ----------------------------------------------------------------------------
// sanitizeRequest: Express middleware chính, gắn vào app bằng app.use(...)
// trước các route để mọi request đều được làm sạch.
// ----------------------------------------------------------------------------
function sanitizeRequest(req, res, next) {
  // Làm sạch body (JSON, form...) nếu có và là object.
  // Lưu ý: middleware parse body (express.json, ...) phải chạy TRƯỚC middleware này.
  if (req.body && typeof req.body === "object") {
    req.body = clean(req.body);
  }

  // Express 5: req.query là getter, mỗi lần đọc lại parse từ URL một lần nữa,
  // nên gán trực tiếp (req.query.x = ...) sẽ không được giữ lại.
  // Cách xử lý:
  //   1. Sao chép query ra object thường bằng spread ({ ...req.query }).
  //   2. Làm sạch bản sao đó.
  //   3. Dùng Object.defineProperty để ghi đè req.query thành giá trị cố định,
  //      khiến các middleware/controller phía sau đọc được dữ liệu đã làm sạch.
  if (req.query && typeof req.query === "object") {
    const query = clean({ ...req.query });
    Object.defineProperty(req, "query", {
      value: query,
      writable: true,     // Cho phép các middleware sau gán lại nếu cần
      configurable: true, // Cho phép định nghĩa lại property này sau này
      enumerable: true,   // Hiện ra khi duyệt/log/spread req.query như bình thường
    });
  }

  // Chuyển quyền xử lý cho middleware/route tiếp theo.
  next();
}

module.exports = sanitizeRequest;
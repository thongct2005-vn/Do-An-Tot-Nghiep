const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const { WALLET_API_URL, MERCHANT_API_KEY, MERCHANT_SECRET_KEY } = process.env;
const PORT = process.env.PORT || 4000;
// Địa chỉ shop mà trình duyệt của khách truy cập được (cổng sẽ chuyển khách về đây sau khi thanh toán)
const SHOP_BASE_URL = (
  process.env.SHOP_BASE_URL || `http://localhost:${PORT}`
).replace(/\/+$/, "");

for (const k of ["WALLET_API_URL", "MERCHANT_API_KEY", "MERCHANT_SECRET_KEY"]) {
  if (!process.env[k]) {
    console.error(`Thiếu biến môi trường ${k}`);
    process.exit(1);
  }
}

const app = express();

// Lưu đơn hàng ra file để tắt/bật lại server vẫn còn đơn
// (bản thật nên dùng database)
const ORDERS_FILE = path.join(__dirname, "orders.json");
const orders = new Map();

try {
  for (const o of JSON.parse(fs.readFileSync(ORDERS_FILE, "utf8"))) {
    orders.set(o.order_id, o);
  }
  console.log(`Đã nạp ${orders.size} đơn hàng từ orders.json`);
} catch (_) {}

function saveOrders() {
  try {
    // Ghi ra file tạm rồi đổi tên để không bị hỏng file nếu server tắt giữa chừng
    const tmp = ORDERS_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify([...orders.values()]));
    fs.renameSync(tmp, ORDERS_FILE);
  } catch (e) {
    console.error("Không lưu được orders.json:", e.message);
  }
}

app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  }),
);

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "shop.html")));

function signRequest(ts, rawBody) {
  return crypto
    .createHmac("sha256", MERCHANT_SECRET_KEY)
    .update(ts + "." + rawBody)
    .digest("hex");
}

function applyStatus(order, rawStatus, paidAt) {
  if (order.status !== "PENDING") return;
  const raw = String(rawStatus ?? "").toUpperCase();
  if (raw === "PAID" || raw === "SUCCESS") {
    order.status = "PAID";
    order.paid_at = paidAt || new Date().toISOString();
    saveOrders();
  } else if (raw === "FAILED" || raw === "FAIL") {
    order.status = "FAILED";
    saveOrders();
  }
}

async function createPayment({
  amount,
  description,
  order_id,
  items,
  return_url,
}) {
  const body = JSON.stringify({
    amount,
    description,
    order_id,
    items,
    return_url,
  });
  const ts = String(Math.floor(Date.now() / 1000));
  const signature = signRequest(ts, body);

  const res = await fetch(
    WALLET_API_URL.replace(/\/$/, "") + "/payments",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": MERCHANT_API_KEY,
        "x-timestamp": ts,
        "x-signature": signature,
        'idempotency-key': 'create-' + order_id,
      },
      body,
    },
  );
  let json = null;
  try {
    json = await res.json();
  } catch (_) {}
  if (!res.ok) {
    const err = new Error(
      (json && json.message) || `Cổng thanh toán trả lỗi ${res.status}`,
    );
    err.statusCode = 502;
    throw err;
  }
  return json && json.data !== undefined ? json.data : json;
}

async function fetchPaymentStatus(orderId) {
  const ts = String(Math.floor(Date.now() / 1000));
  const signature = signRequest(ts, "");

  const res = await fetch(
    WALLET_API_URL.replace(/\/$/, "") +
      "/payments/" +
      encodeURIComponent(orderId),
    {
      method: "GET",
      headers: {
        "x-api-key": MERCHANT_API_KEY,
        "x-timestamp": ts,
        "x-signature": signature,
      },
    },
  );
  let json = null;
  try {
    json = await res.json();
  } catch (_) {}
  if (!res.ok) {
    const err = new Error(
      (json && json.message) || `Cổng thanh toán trả lỗi ${res.status}`,
    );
    err.statusCode = 502;
    throw err;
  }
  return json && json.data !== undefined ? json.data : json;
}

// Hỏi cổng thanh toán trạng thái đơn rồi cập nhật đơn trong shop
async function syncOrder(order) {
  if (order.status !== "PENDING") return order;
  const data = await fetchPaymentStatus(order.order_id);
  if (Number(data.amount) !== order.amount) {
    const err = new Error(
      "Số tiền từ cổng thanh toán không khớp với đơn hàng",
    );
    err.statusCode = 502;
    throw err;
  }
  applyStatus(order, data.status, data.paid_at);
  return order;
}

// Tạo đơn trong shop rồi tạo thanh toán ở cổng. Trả về { order_id, amount, payment }.
// payment gồm qr_image (luồng QR) và payment_url (Redirect flow).
async function createOrder(items) {
  if (!Array.isArray(items) || !items.length) {
    const err = new Error("Giỏ hàng trống");
    err.statusCode = 400;
    throw err;
  }
  const amount = items.reduce((s, i) => s + Number(i.price) * Number(i.qty), 0);
  if (!Number.isInteger(amount) || amount <= 0) {
    const err = new Error("Dữ liệu giỏ hàng không hợp lệ");
    err.statusCode = 400;
    throw err;
  }

  const orderId = "DH" + Date.now().toString(36).toUpperCase();
  orders.set(orderId, {
    order_id: orderId,
    items,
    amount,
    status: "PENDING",
    paid_at: null,
    created_at: new Date().toISOString(),
  });
  saveOrders();

  try {
    const payment = await createPayment({
      amount,
      description: "Don hang " + orderId,
      order_id: orderId,
      // Redirect flow: sau khi thanh toán xong, khách bấm "Quay lại cửa hàng" trên trang cổng
      // và được đưa về route này, kèm order_id, payment_id, amount, status, paid_at, timestamp, signature.
      // Route /checkout/result kiểm tra chữ ký trước khi tin bất cứ tham số nào.
      return_url: SHOP_BASE_URL + "/checkout/result",
      items: items.map((i) => ({
        product_id: String(i.id),
        name: i.name,
        quantity: Number(i.qty),
        unit_price: Number(i.price),
        description: i.description ?? null,
      })),
    });
    const order = orders.get(orderId);
    if (order && payment && payment.id) {
      order.payment_id = String(payment.id);
      saveOrders();
    }
    return { order_id: orderId, amount, payment };
  } catch (e) {
    orders.delete(orderId);
    saveOrders();
    throw e;
  }
}

app.post("/orders", async (req, res) => {
  try {
    const result = await createOrder((req.body || {}).items);
    res.json(result);
  } catch (e) {
    res.status(e.statusCode || 500).json({ message: e.message });
  }
});

app.get("/orders/:id", (req, res) => {
  const order = orders.get(req.params.id);
  if (!order)
    return res.status(404).json({ message: "Không tìm thấy đơn hàng" });
  res.json(order);
});

// Chủ động hỏi cổng thanh toán trạng thái đơn rồi cập nhật đơn trong shop
app.post("/orders/:id/sync", async (req, res) => {
  const order = orders.get(req.params.id);
  if (!order)
    return res.status(404).json({ message: "Không tìm thấy đơn hàng" });

  try {
    await syncOrder(order);
    res.json(order);
  } catch (e) {
    res.status(e.statusCode || 500).json({ message: e.message });
  }
});

// ---- Khách quay về từ trang thanh toán của cổng ----
// URL: /checkout/result?order_id=&payment_id=&amount=&status=&paid_at=&timestamp=&signature=
// Chữ ký: HMAC_SHA256_hex(secret_key, `${timestamp}.${data}`)
//   data = `${payment_id}|${amount}|${status}|${paid_at}|${order_id}` (paid_at rỗng nếu không có)
const RETURN_MAX_AGE_SECONDS = 60 * 60;

function isSameHex(received, expected) {
  const a = Buffer.from(String(received));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.get("/checkout/result", (req, res) => {
  // Mỗi tham số phải là chuỗi (chặn trường hợp ?status=a&status=b thành mảng)
  const s = (k) => (typeof req.query[k] === "string" ? req.query[k] : "");
  const fail = (reason) => {
    console.log("Return URL bị từ chối:", reason);
    res.redirect(303, "/?return_error=" + reason);
  };

  // 1) Chữ ký trước tiên. Sai hoặc thiếu thì bỏ qua mọi tham số còn lại.
  const data = [
    s("payment_id"),
    s("amount"),
    s("status"),
    s("paid_at"),
    s("order_id"),
  ].join("|");
  const timestamp = s("timestamp");
  if (!timestamp || !s("signature")) return fail("invalid_signature");
  if (!isSameHex(s("signature"), signRequest(timestamp, data))) {
    return fail("invalid_signature");
  }

  // 2) Dấu thời gian còn mới
  const ts = Number(timestamp);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(ts) || Math.abs(now - ts) > RETURN_MAX_AGE_SECONDS) {
    return fail("expired");
  }

  // 3) Đối chiếu với đơn của shop (không tin số tiền / mã thanh toán trên URL)
  const order = orders.get(s("order_id"));
  if (!order) return fail("order_not_found");
  if (order.payment_id && order.payment_id !== s("payment_id")) {
    return fail("mismatch");
  }
  if (Number(s("amount")) !== order.amount) return fail("mismatch");

  // 4) Trạng thái đã được ký nên mới được dùng. Cập nhật idempotent như callback.
  applyStatus(order, s("status"), s("paid_at") || null);

  res.redirect(303, "/?order_id=" + encodeURIComponent(order.order_id));
});

app.post("/callback", (req, res) => {
  const rawBody = req.rawBody;
  const timestamp = req.header("X-Timestamp") || req.header("x-timestamp");
  const signature =
    req.header("X-Signature") || req.header("x-signature") || "";

  if (!timestamp || !signature) {
    console.log("Callback thiếu thông tin xác thực (Timestamp hoặc Signature)");
    return res.status(401).json({ message: "Missing authentication headers" });
  }

  const expectedSignature = signRequest(timestamp, rawBody);
  const isValid =
    signature.length === expectedSignature.length &&
    crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature),
    );

  if (!isValid) {
    console.log("Callback giả mạo - Chữ ký không hợp lệ!");
    return res.status(401).json({ message: "Invalid signature" });
  }

  console.log("Callback hợp lệ từ Cổng thanh toán!");

  const body = req.body?.data ?? req.body ?? {};
  const order = orders.get(body.order_id);
  if (!order)
    return res.status(404).json({ message: "Không tìm thấy đơn hàng" });

  applyStatus(order, body.status);

  res.json({ received: true });
});

app.listen(PORT, () => console.log(`Shop chạy tại http://localhost:${PORT}`));
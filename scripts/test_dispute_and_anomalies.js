const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const pool = require("../src/config/database");
const adminTransactionRepository = require("../src/admin/transaction/transaction.repository");
const adminTransactionService = require("../src/admin/transaction/transaction.service");
const assert = require("assert");

async function runTests() {
  console.log("=== BẮT ĐẦU KIỂM THỬ TÍCH HỢP GIAI ĐOẠN 7 (Change 1) ===");

  const client = await pool.connect();
  const TEST_TX_ID = "999999999001";
  let adminUser = null;
  let normalUser = null;

  try {
    // Lấy 1 admin user và 1 user thường từ database để phục vụ test
    const adminRes = await client.query(
      "SELECT id, full_name, email FROM users WHERE role = 'ADMIN' LIMIT 1"
    );
    if (adminRes.rows.length === 0) {
      throw new Error("Không tìm thấy người dùng có vai trò ADMIN");
    }
    adminUser = adminRes.rows[0];

    const userRes = await client.query(
      "SELECT id, full_name, email FROM users WHERE role = 'USER' LIMIT 2"
    );
    if (userRes.rows.length === 0) {
      throw new Error("Không tìm thấy người dùng thường");
    }
    normalUser = userRes.rows[0];
    const receiverUser = userRes.rows[1] || normalUser;

    // Dọn dẹp dữ liệu test cũ nếu còn
    await client.query(
      "DELETE FROM admin_user_change_history WHERE (new_values->>'transaction_id') = $1",
      [TEST_TX_ID]
    );
    await client.query("DELETE FROM transactions WHERE id = $1", [TEST_TX_ID]);

    // Tạo giao dịch test
    await client.query(
      `INSERT INTO transactions (
        id, transaction_type, source_user_id, destination_user_id,
        amount, fee, status, description,
        source_balance_before, source_balance_after,
        dest_balance_before, dest_balance_after,
        created_at
      ) VALUES (
        $1, 'TRANSFER', $2, $3,
        50000, 0, 'SUCCESS', 'Test Dispute & Anomaly',
        500000, 450000,
        100000, 150000,
        NOW()
      )`,
      [TEST_TX_ID, normalUser.id, receiverUser.id]
    );

    console.log(`[SETUP] Đã tạo giao dịch test ID: ${TEST_TX_ID}`);

    // =========================================================================
    // TIÊU CHÍ 1: Constraint DB chấp nhận 3 action DISPUTE_*
    // =========================================================================
    console.log("\n--- [TIÊU CHÍ 1] Kiểm tra chk_admin_change_action nhận 3 action DISPUTE_* ---");
    const actions = ["DISPUTE_OPENED", "DISPUTE_UPDATED", "DISPUTE_RESOLVED"];
    for (const act of actions) {
      const insRes = await adminTransactionRepository.insertDisputeEvent(client, {
        adminId: adminUser.id,
        userId: normalUser.id,
        action: act,
        reason: `Kiểm tra constraint ${act}`,
        newValues: {
          transaction_id: TEST_TX_ID,
          dispute_id: "test-constraint-uuid",
          dispute_status: act === "DISPUTE_RESOLVED" ? "RESOLVED" : "OPEN",
        },
      });
      assert.strictEqual(insRes.action, act, `Action ${act} phải được chèn thành công`);
    }
    console.log("=> PASSED: Cả 3 action DISPUTE_* đều được lưu thành công vào PostgreSQL!");

    // Dọn dẹp các bản ghi test constraint
    await client.query(
      "DELETE FROM admin_user_change_history WHERE (new_values->>'transaction_id') = $1",
      [TEST_TX_ID]
    );

    // =========================================================================
    // TIÊU CHÍ 2: Kiểm tra tính toàn vẹn số dư và cảnh báo bất thường
    // =========================================================================
    console.log("\n--- [TIÊU CHÍ 2] Kiểm tra logic toàn vẹn số dư & cảnh báo bất thường ---");

    // 2.1. TRANSFER hợp lệ
    const txTransferOk = {
      id: "1",
      transaction_type: "TRANSFER",
      status: "SUCCESS",
      amount: 100000,
      fee: 1000,
      source_balance_before: 500000,
      source_balance_after: 399000,
      dest_balance_before: 200000,
      dest_balance_after: 300000,
      created_at: new Date().toISOString(),
    };
    // Tạm gọi getTransactionDetail hoặc test qua repository/service
    // Chúng ta test hàm detail thông qua mock hoặc gọi getTransactionDetail
    const detailTransferOk = await adminTransactionService.getTransactionDetail(TEST_TX_ID);
    assert.strictEqual(
      detailTransferOk.integrity_checks.overall_status,
      "OK",
      "Giao dịch khớp số dư phải có overall_status là OK"
    );
    assert.strictEqual(detailTransferOk.integrity_checks.source_snapshot_status, "VALID");
    assert.strictEqual(detailTransferOk.integrity_checks.dest_snapshot_status, "VALID");
    console.log("  [2.1] TRANSFER hợp lệ -> OK, VALID, VALID: ĐẠT");

    // 2.2. Kiểm tra giao dịch TOPUP hợp lệ (dest_balance_* IS NULL)
    await client.query(
      `UPDATE transactions 
       SET transaction_type = 'TOPUP', destination_user_id = NULL,
           dest_balance_before = NULL, dest_balance_after = NULL,
           source_balance_before = 100000, source_balance_after = 200000,
           amount = 100000, fee = 0
       WHERE id = $1`,
      [TEST_TX_ID]
    );
    const detailTopup = await adminTransactionService.getTransactionDetail(TEST_TX_ID);
    assert.strictEqual(detailTopup.integrity_checks.overall_status, "OK");
    assert.strictEqual(detailTopup.integrity_checks.dest_snapshot_status, "NOT_APPLICABLE");
    console.log("  [2.2] TOPUP hợp lệ (dest_balance null) -> OK, NOT_APPLICABLE: ĐẠT");

    // 2.3. Kiểm tra giao dịch WITHDRAW hợp lệ (dest_balance_* IS NULL)
    await client.query(
      `UPDATE transactions 
       SET transaction_type = 'WITHDRAW', destination_user_id = NULL,
           dest_balance_before = NULL, dest_balance_after = NULL,
           source_balance_before = 500000, source_balance_after = 398000,
           amount = 100000, fee = 2000
       WHERE id = $1`,
      [TEST_TX_ID]
    );
    const detailWithdraw = await adminTransactionService.getTransactionDetail(TEST_TX_ID);
    assert.strictEqual(detailWithdraw.integrity_checks.overall_status, "OK");
    assert.strictEqual(detailWithdraw.integrity_checks.dest_snapshot_status, "NOT_APPLICABLE");
    console.log("  [2.3] WITHDRAW hợp lệ (dest_balance null) -> OK, NOT_APPLICABLE: ĐẠT");

    // 2.4. Kiểm tra thiếu snapshot bắt buộc (MISSING_SNAPSHOT)
    await client.query(
      `UPDATE transactions 
       SET transaction_type = 'TRANSFER', destination_user_id = $2,
           source_balance_before = NULL, source_balance_after = NULL,
           dest_balance_before = 100000, dest_balance_after = 200000
       WHERE id = $1`,
      [TEST_TX_ID, receiverUser.id]
    );
    const detailMissing = await adminTransactionService.getTransactionDetail(TEST_TX_ID);
    assert.strictEqual(
      detailMissing.integrity_checks.overall_status,
      "MISSING_SNAPSHOT",
      "Thiếu snapshot phải gắn overall_status là MISSING_SNAPSHOT"
    );
    const hasMissingSnapshotAnomaly = detailMissing.anomalies.some(
      (a) => a.code === "MISSING_SNAPSHOT" && a.severity === "WARNING"
    );
    const hasBalanceMismatchAnomaly = detailMissing.anomalies.some(
      (a) => a.code === "BALANCE_MISMATCH"
    );
    assert.strictEqual(hasMissingSnapshotAnomaly, true, "Phải có cảnh báo MISSING_SNAPSHOT");
    assert.strictEqual(
      hasBalanceMismatchAnomaly,
      false,
      "Khi thiếu snapshot, KHÔNG ĐƯỢC gắn cảnh báo BALANCE_MISMATCH"
    );
    console.log("  [2.4] Ưu tiên MISSING_SNAPSHOT trước BALANCE_MISMATCH: ĐẠT");

    // 2.5. Kiểm tra sai lệch số dư (BALANCE_MISMATCH)
    await client.query(
      `UPDATE transactions 
       SET transaction_type = 'TRANSFER', destination_user_id = $2,
           source_balance_before = 500000, source_balance_after = 450000,
           dest_balance_before = 100000, dest_balance_after = 120000,
           amount = 100000, fee = 0
       WHERE id = $1`,
      [TEST_TX_ID, receiverUser.id]
    );
    const detailMismatch = await adminTransactionService.getTransactionDetail(TEST_TX_ID);
    assert.strictEqual(
      detailMismatch.integrity_checks.overall_status,
      "MISMATCH",
      "Số dư sai lệch phải có overall_status là MISMATCH"
    );
    assert.strictEqual(
      detailMismatch.anomalies.some(
        (a) => a.code === "BALANCE_MISMATCH" && a.severity === "CRITICAL"
      ),
      true,
      "Phải có cảnh báo BALANCE_MISMATCH mức CRITICAL"
    );
    console.log("  [2.5] Phát hiện BALANCE_MISMATCH khi đủ snapshot nhưng sai lệch số học: ĐẠT");

    // 2.6. Kiểm tra giao dịch giá trị lớn (HIGH_VALUE_TX)
    await client.query(
      `UPDATE transactions 
       SET amount = 15000000, fee = 0,
           source_balance_before = 20000000, source_balance_after = 5000000,
           dest_balance_before = 1000000, dest_balance_after = 16000000
       WHERE id = $1`,
      [TEST_TX_ID]
    );
    const detailHighVal = await adminTransactionService.getTransactionDetail(TEST_TX_ID);
    assert.strictEqual(
      detailHighVal.integrity_checks.overall_status,
      "OK",
      "Giao dịch giá trị lớn khớp số dư vẫn phải có overall_status là OK"
    );
    assert.strictEqual(
      detailHighVal.anomalies.some(
        (a) => a.code === "HIGH_VALUE_TX" && a.severity === "INFO"
      ),
      true,
      "Phải có cảnh báo HIGH_VALUE_TX mức INFO"
    );
    console.log("  [2.6] Giao dịch giá trị lớn (>=10M) có HIGH_VALUE_TX mà vẫn giữ overall_status OK: ĐẠT");

    // 2.7. Kiểm tra giao dịch treo quá hạn (STUCK_PENDING)
    await client.query(
      `UPDATE transactions 
       SET status = 'PENDING',
           created_at = NOW() - INTERVAL '20 minutes'
       WHERE id = $1`,
      [TEST_TX_ID]
    );
    const detailStuck = await adminTransactionService.getTransactionDetail(TEST_TX_ID);
    assert.strictEqual(
      detailStuck.anomalies.some(
        (a) => a.code === "STUCK_PENDING" && a.severity === "WARNING"
      ),
      true,
      "Giao dịch PENDING > 15 phút phải có cảnh báo STUCK_PENDING"
    );
    console.log("  [2.7] Giao dịch PENDING > 15 phút phát hiện STUCK_PENDING: ĐẠT");

    // 2.8. Kiểm tra lọc qua Repository
    const stuckList = await adminTransactionRepository.getTransactions({
      anomaly: "STUCK_PENDING",
      limit: 10,
      offset: 0,
    });
    const foundStuck = stuckList.some((t) => String(t.id) === TEST_TX_ID);
    assert.strictEqual(foundStuck, true, "Repository filter anomaly=STUCK_PENDING phải tìm thấy tx test");
    console.log("  [2.8] Bộ lọc SQL anomaly=STUCK_PENDING hoạt động chính xác: ĐẠT");

    // =========================================================================
    // TIÊU CHÍ 3: Quản lý vòng đời tra soát & Chặn mở trùng hồ sơ đang mở (409)
    // =========================================================================
    console.log("\n--- [TIÊU CHÍ 3] Chặn mở trùng hồ sơ tra soát đang hoạt động (409) ---");

    // Mở hồ sơ đầu tiên
    const opened = await adminTransactionService.openDispute(TEST_TX_ID, {
      disputeType: "STUCK_PENDING",
      reason: "Giao dịch treo quá 15 phút cần tra soát",
      authorizationReference: "DSP-TEST-001",
      note: "Yêu cầu từ khách hàng qua hotline",
      currentUser: adminUser,
    });
    assert.strictEqual(opened.dispute_status, "OPEN");
    assert.ok(opened.dispute_id, "Phải sinh dispute_id (UUIDv7)");
    console.log(`  [3.1] Mở hồ sơ tra soát thành công với dispute_id: ${opened.dispute_id}`);

    // Mở thêm hồ sơ thứ 2 trên cùng giao dịch -> Mong đợi 409 Conflict
    let openConflictError = null;
    try {
      await adminTransactionService.openDispute(TEST_TX_ID, {
        disputeType: "CUSTOMER_COMPLAINT",
        reason: "Yêu cầu mở thêm hồ sơ thứ hai",
        currentUser: adminUser,
      });
    } catch (err) {
      openConflictError = err;
    }
    assert.ok(openConflictError, "Phải quăng lỗi khi mở trùng hồ sơ đang mở");
    assert.strictEqual(openConflictError.statusCode, 409, "Mã lỗi phải là 409 Conflict");
    console.log(`  [3.2] Chặn mở trùng hồ sơ active thành công với lỗi 409: "${openConflictError.message}"`);

    // =========================================================================
    // TIÊU CHÍ 4: Chặn cập nhật vào hồ sơ đã RESOLVED (409)
    // =========================================================================
    console.log("\n--- [TIÊU CHÍ 4] Cập nhật tiến độ & Chặn sửa hồ sơ đã RESOLVED (409) ---");

    // 4.1. Cập nhật tiến độ INVESTIGATING
    const updated = await adminTransactionService.appendDisputeEvent(
      TEST_TX_ID,
      opened.dispute_id,
      {
        action: "DISPUTE_UPDATED",
        disputeStatus: "INVESTIGATING",
        reason: "Đang đối chiếu dữ liệu cổng thanh toán",
        note: "Liên hệ ngân hàng xác minh",
        currentUser: adminUser,
      }
    );
    assert.strictEqual(updated.dispute_status, "INVESTIGATING");
    console.log("  [4.1] Cập nhật tiến độ INVESTIGATING thành công!");

    // 4.2. Kết luận và đóng hồ sơ (RESOLVED)
    const resolved = await adminTransactionService.appendDisputeEvent(
      TEST_TX_ID,
      opened.dispute_id,
      {
        action: "DISPUTE_RESOLVED",
        disputeStatus: "RESOLVED",
        resolutionResult: "CONFIRMED_DISCREPANCY",
        reason: "Xác nhận giao dịch bị timeout từ phía ngân hàng",
        note: "Đã gửi thông báo cho khách hàng",
        currentUser: adminUser,
      }
    );
    assert.strictEqual(resolved.dispute_status, "RESOLVED");
    assert.strictEqual(resolved.resolution_result, "CONFIRMED_DISCREPANCY");
    console.log("  [4.2] Kết luận và đóng hồ sơ (RESOLVED) thành công!");

    // 4.3. Cố tình cập nhật tiếp vào hồ sơ đã RESOLVED -> Mong đợi 409 Conflict
    let resolvedConflictError = null;
    try {
      await adminTransactionService.appendDisputeEvent(
        TEST_TX_ID,
        opened.dispute_id,
        {
          action: "DISPUTE_UPDATED",
          disputeStatus: "INVESTIGATING",
          reason: "Cố tình cập nhật sau khi đã đóng",
          currentUser: adminUser,
        }
      );
    } catch (err) {
      resolvedConflictError = err;
    }
    assert.ok(resolvedConflictError, "Phải quăng lỗi khi sửa hồ sơ đã RESOLVED");
    assert.strictEqual(resolvedConflictError.statusCode, 409, "Mã lỗi phải là 409 Conflict");
    console.log(`  [4.3] Chặn sửa hồ sơ đã RESOLVED thành công với lỗi 409: "${resolvedConflictError.message}"`);

    // 4.4. Mở hồ sơ mới sau khi hồ sơ trước đã RESOLVED -> Thành công!
    const secondDispute = await adminTransactionService.openDispute(TEST_TX_ID, {
      disputeType: "CUSTOMER_COMPLAINT",
      reason: "Khách hàng khiếu nại đợt 2 sau khi hồ sơ cũ đã đóng",
      currentUser: adminUser,
    });
    assert.strictEqual(secondDispute.dispute_status, "OPEN");
    assert.notStrictEqual(secondDispute.dispute_id, opened.dispute_id);
    console.log(`  [4.4] Mở hồ sơ mới sau khi hồ sơ cũ RESOLVED thành công! (ID mới: ${secondDispute.dispute_id})`);

    // =========================================================================
    // TIÊU CHÍ 5: Lịch sử sự kiện giao dịch (Timeline)
    // =========================================================================
    console.log("\n--- [TIÊU CHÍ 5] Kiểm tra Timeline sự kiện giao dịch thực tế ---");
    const timeline = await adminTransactionRepository.getTransactionTimeline(TEST_TX_ID);
    assert.ok(timeline.length >= 4, "Timeline phải có ít nhất 4 sự kiện (tạo tx + 3 sự kiện dispute)");
    const eventTypes = timeline.map((e) => e.event_type);
    console.log("  Các sự kiện thực tế ghi nhận trong timeline:", eventTypes);
    assert.ok(eventTypes.includes("TRANSACTION_CREATED"), "Phải có sự kiện TRANSACTION_CREATED");
    assert.ok(eventTypes.includes("DISPUTE_OPENED"), "Phải có sự kiện DISPUTE_OPENED");
    assert.ok(eventTypes.includes("DISPUTE_UPDATED"), "Phải có sự kiện DISPUTE_UPDATED");
    assert.ok(eventTypes.includes("DISPUTE_RESOLVED"), "Phải có sự kiện DISPUTE_RESOLVED");

    // Kiểm tra thứ tự thời gian
    for (let i = 1; i < timeline.length; i++) {
      const prevTime = new Date(timeline[i - 1].timestamp).getTime();
      const currTime = new Date(timeline[i].timestamp).getTime();
      assert.ok(currTime >= prevTime, "Timeline phải được sắp xếp tăng dần theo thời gian");
    }
    console.log("=> PASSED: Timeline sắp xếp đúng trình tự nhân quả và dựa 100% trên bản ghi thực tế!");

    console.log("\n=======================================================");
    console.log(" TẤT CẢ 5 TIÊU CHÍ NGHIỆM THU ĐỀU ĐẠT CHUẨN 100%!");
    console.log("=======================================================");
  } catch (err) {
    console.error("\n❌ KIỂM THỬ THẤT BẠI:", err);
    process.exitCode = 1;
  } finally {
    // Dọn dẹp sạch sẽ dữ liệu test
    console.log("\n[CLEANUP] Dọn dẹp bản ghi test...");
    await client.query(
      "DELETE FROM admin_user_change_history WHERE (new_values->>'transaction_id') = $1",
      [TEST_TX_ID]
    );
    await client.query("DELETE FROM transactions WHERE id = $1", [TEST_TX_ID]);
    client.release();
    await pool.end();
    console.log("[CLEANUP] Đã dọn dẹp sạch sẽ. Database hoàn toàn nguyên vẹn.");
  }
}

runTests();

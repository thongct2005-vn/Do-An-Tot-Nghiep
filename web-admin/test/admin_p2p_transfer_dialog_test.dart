import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:web_admin/features/user/data/user_api_service.dart';
import 'package:web_admin/features/user/models/user_model.dart';
import 'package:web_admin/features/user/presentation/widgets/admin_p2p_transfer_dialog.dart';
import 'package:web_admin/features/user/presentation/widgets/user_detail_drawer.dart';

void main() {
  setUpAll(() async {
    await initializeDateFormatting('vi_VN', null);
  });

  UserModel buildTestUser({
    String id = '0196ed40-0000-7000-8000-00000000000a',
    String name = 'Nguyễn Văn A',
    String phone = '0912345678',
    UserStatus status = UserStatus.active,
    num balance = 2000000,
    num dailyLimit = 50000000,
    num dailyUsed = 500000,
  }) {
    return UserModel(
      id: id,
      name: name,
      phone: phone,
      email: 'usera@ewallet.vn',
      kycStatus: KycStatus.verified,
      status: status,
      balance: balance,
      bankName: 'Vietcombank',
      bankAccount: '1012345678',
      dailyLimit: dailyLimit,
      dailyUsed: dailyUsed,
      monthlyLimit: 200000000,
      monthlyUsed: 1000000,
      createdAt: DateTime(2026, 1, 15, 8, 30),
      auditLogs: const [],
    );
  }

  testWidgets(
    'UserDetailDrawer vô hiệu hóa nút Lệnh Chuyển tiền P2P kèm thông báo khi tài khoản nguồn bị khóa (BLOCKED)',
    (WidgetTester tester) async {
      tester.view.physicalSize = const Size(1440, 900);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final mockClient = MockClient((request) async {
        return http.Response(
          jsonEncode({
            'status': 'success',
            'data': {
              'items': [],
              'pagination': {
                'total_items': 0,
                'total_pages': 1,
                'current_page': 1,
                'limit': 5,
              },
            },
          }),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      });

      final blockedUser = buildTestUser(status: UserStatus.suspended);
      final apiService = UserApiService(client: mockClient, token: 'token');

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: UserDetailDrawer(
              user: blockedUser,
              apiService: apiService,
              onClose: () {},
              onDeactivateTap: () {},
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(
        find.text(
          'Tài khoản đang bị khóa. Không thể thực hiện chuyển tiền cho đến khi được kích hoạt lại.',
        ),
        findsOneWidget,
      );

      await tester.tap(find.text('Lệnh Chuyển tiền P2P'));
      await tester.pumpAndSettle();

      // Hộp thoại không được mở khi tài khoản bị khóa
      expect(
        find.text('Khởi Tạo Lệnh Chuyển Tiền P2P (Bước 1/2)'),
        findsNothing,
      );
    },
  );

  testWidgets(
    'AdminP2PTransferDialog thực hiện đối soát chính xác người nhận, xác nhận Bước 2 và quản lý Idempotency-Key chuẩn xác',
    (WidgetTester tester) async {
      tester.view.physicalSize = const Size(1440, 1000);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final capturedIdempotencyKeys = <String>[];
      int postAttempt = 0;

      final mockClient = MockClient((request) async {
        if (request.method == 'GET' &&
            request.url.path.endsWith('/api/v2/admin/user')) {
          final search = request.url.queryParameters['search'] ?? '';
          if (search == '0987654321') {
            return http.Response(
              jsonEncode({
                'status': 'success',
                'data': {
                  'items': [
                    {
                      'id': '0196ed40-0000-7000-8000-000000000099',
                      'full_name': 'Người Không Khớp Chính Xác',
                      'phone': '0987654329',
                      'status': 'ACTIVE',
                      'balance': 100000,
                    },
                    {
                      'id': '0196ed40-0000-7000-8000-00000000000b',
                      'full_name': 'Trần Thị Bích',
                      'phone': '0987654321',
                      'status': 'ACTIVE',
                      'balance': 500000,
                    },
                  ],
                  'pagination': {
                    'total_items': 2,
                    'total_pages': 1,
                    'current_page': 1,
                    'limit': 5,
                  },
                },
              }),
              200,
              headers: {'content-type': 'application/json; charset=utf-8'},
            );
          }
          return http.Response(
            jsonEncode({
              'status': 'success',
              'data': {
                'items': [],
                'pagination': {
                  'total_items': 0,
                  'total_pages': 1,
                  'current_page': 1,
                  'limit': 5,
                },
              },
            }),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }

        if (request.method == 'POST' &&
            request.url.path.contains('/operations/p2p')) {
          postAttempt++;
          capturedIdempotencyKeys.add(request.headers['Idempotency-Key'] ?? '');

          if (postAttempt == 1) {
            // Lần 1: Giả lập mất mạng (statusCode == 0)
            throw Exception('Network timeout');
          }
          if (postAttempt == 2) {
            // Lần 2: Gửi lại cùng key nhưng giả lập sai mật khẩu Admin (401)
            return http.Response(
              jsonEncode({
                'status': 'error',
                'message': 'Mật khẩu xác nhận của Quản trị viên không chính xác',
              }),
              401,
              headers: {'content-type': 'application/json; charset=utf-8'},
            );
          }
          // Lần 3: Thành công với Idempotency-Key mới sau lỗi 401
          return http.Response(
            jsonEncode({
              'status': 'success',
              'message': 'Thực hiện chuyển tiền P2P thành công',
              'replayed': false,
              'data': {
                'transaction_id': '100999',
                'status': 'SUCCESS',
                'amount': 500000,
                'fee': 0,
                'description': 'Admin hỗ trợ chuyển tiền (TICKET-2026-888)',
                'reason': 'Hỗ trợ xử lý khiếu nại khách hàng',
                'authorization_reference': 'TICKET-2026-888',
                'source_user_id': '0196ed40-0000-7000-8000-00000000000a',
                'source_user_name': 'Nguyễn Văn A',
                'source_balance_before': 2000000,
                'source_balance_after': 1500000,
                'destination_user_id': '0196ed40-0000-7000-8000-00000000000b',
                'destination_user_name': 'Trần Thị Bích',
                'destination_phone_masked': '*********321',
                'created_at': '2026-10-31T13:30:00Z',
              },
            }),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }

        return http.Response('{}', 404);
      });

      final apiService = UserApiService(client: mockClient, token: 'token');
      final sourceUser = buildTestUser();
      AdminP2PTransferResult? dialogResult;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) => ElevatedButton(
                onPressed: () async {
                  dialogResult = await AdminP2PTransferDialog.show(
                    context,
                    user: sourceUser,
                    apiService: apiService,
                  );
                },
                child: const Text('Mở Dialog'),
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.text('Mở Dialog'));
      await tester.pumpAndSettle();

      expect(
        find.text('Khởi Tạo Lệnh Chuyển Tiền P2P (Bước 1/2)'),
        findsOneWidget,
      );

      // Nhập SĐT người nhận và bấm Tra cứu
      final textFields = find.byType(TextFormField);
      await tester.enterText(textFields.at(0), '0987654321');
      await tester.tap(find.text('Tra cứu'));
      await tester.pumpAndSettle();

      // Phải chọn đúng Trần Thị Bích (khớp chính xác 0987654321), không lấy phần tử đầu tiên (0987654329)
      expect(find.text('Người nhận đã xác minh'), findsOneWidget);
      expect(find.textContaining('Trần Thị Bích'), findsOneWidget);

      // Chọn số tiền 500,000 đ và nhập mã Ticket
      await tester.tap(find.text('500,000 đ'));
      await tester.pump();
      await tester.enterText(textFields.at(2), 'TICKET-2026-888');
      await tester.pump();

      // Chuyển sang Bước 2
      await tester.tap(find.text('Tiếp tục xác nhận'));
      await tester.pumpAndSettle();

      expect(
        find.text('Xác Nhận Lệnh Chuyển Tiền P2P (Bước 2/2)'),
        findsOneWidget,
      );
      expect(
        find.text('BẢNG ĐỐI CHIẾU THÔNG TIN GIAO DỊCH CUỐI CÙNG'),
        findsOneWidget,
      );
      expect(find.text('TICKET-2026-888'), findsOneWidget);

      // Nhập mật khẩu Admin và gửi lần 1 (mất mạng -> giữ nguyên Idempotency-Key)
      await tester.enterText(find.byType(TextFormField), 'WrongPass');
      await tester.tap(find.text('Xác Nhận & Thực Hiện Lệnh Chuyển'));
      await tester.pumpAndSettle();

      expect(capturedIdempotencyKeys.length, 1);
      expect(find.text('Gửi Lại Lệnh Chuyển (Cùng Key)'), findsOneWidget);

      // Gửi lại lần 2 sau lỗi mạng -> Phải dùng CÙNG Idempotency-Key của lần 1, nhưng nhận lỗi 401
      await tester.tap(find.text('Gửi Lại Lệnh Chuyển (Cùng Key)'));
      await tester.pumpAndSettle();

      expect(capturedIdempotencyKeys.length, 2);
      expect(capturedIdempotencyKeys[1], equals(capturedIdempotencyKeys[0]));
      expect(
        find.text('Mật khẩu xác nhận của Quản trị viên không chính xác'),
        findsOneWidget,
      );

      // Lần 3: Sau lỗi nghiệp vụ 401, gửi lại phải sinh Idempotency-Key MỚI và thành công
      await tester.enterText(find.byType(TextFormField), 'AdminSecret@123');
      await tester.tap(find.text('Xác Nhận & Thực Hiện Lệnh Chuyển'));
      await tester.pumpAndSettle();

      expect(capturedIdempotencyKeys.length, 3);
      expect(capturedIdempotencyKeys[2], isNot(equals(capturedIdempotencyKeys[1])));
      expect(dialogResult, isNotNull);
      expect(dialogResult!.transactionId, '100999');
      expect(dialogResult!.sourceBalanceAfter, 1500000);
    },
  );
}


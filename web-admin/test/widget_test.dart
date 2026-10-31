import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:web_admin/app.dart';
import 'package:web_admin/features/user/data/user_api_service.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('WebAdminApp ban đầu hiển thị màn hình Đăng nhập Quản trị', (WidgetTester tester) async {
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(const WebAdminApp());
    await tester.pumpAndSettle();

    expect(find.text('E-Wallet Admin'), findsOneWidget);
    expect(find.text('Đăng nhập quản trị'), findsOneWidget);
    expect(find.text('Đăng nhập'), findsOneWidget);
  });

  testWidgets('E-Wallet Web Admin comprehensive feature test sau khi đã xác thực', (WidgetTester tester) async {
    // Set standard Desktop Web Viewport (1440x900)
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final mockClient = MockClient((request) async {
      if (request.url.path.contains('/api/v2/admin/user/stats')) {
        return http.Response(
          jsonEncode({
            'status': 'success',
            'code': 200,
            'data': {
              'total_users': 1,
              'active_users': 1,
              'suspended_users': 0,
            },
          }),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }
      if (request.url.path.endsWith('/api/v2/admin/user')) {
        return http.Response(
          jsonEncode({
            'status': 'success',
            'code': 200,
            'data': {
              'items': [
                {
                  'id': 'USR-001',
                  'name': 'Nguyễn Văn An',
                  'phone': '0912345678',
                  'email': 'nguyenvanan@gmail.com',
                  'kyc_status': 'APPROVED',
                  'status': 'ACTIVE',
                  'balance': 15000000,
                  'bank_name': 'Vietcombank',
                  'bank_account': '1012345678',
                  'daily_limit': 50000000,
                  'daily_used': 5000000,
                  'monthly_limit': 200000000,
                  'monthly_used': 25000000,
                  'created_at': '2024-01-15T08:30:00Z',
                  'audit_logs': [
                    {
                      'timestamp': '2024-10-28T10:15:00Z',
                      'action': 'Đăng nhập ứng dụng',
                      'device': 'iPhone 15 Pro',
                      'ip_address': '192.168.1.1',
                    }
                  ],
                }
              ],
              'pagination': {
                'total_items': 1,
                'total_pages': 1,
                'current_page': 1,
                'limit': 10,
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
          'code': 200,
          'data': {
            'id': 'USR-001',
            'name': 'Nguyễn Văn An',
            'phone': '0912345678',
            'email': 'nguyenvanan@gmail.com',
            'kyc_status': 'APPROVED',
            'status': 'ACTIVE',
            'balance': 15000000,
            'bank_name': 'Vietcombank',
            'bank_account': '1012345678',
            'daily_limit': 50000000,
            'daily_used': 5000000,
            'monthly_limit': 200000000,
            'monthly_used': 25000000,
            'created_at': '2024-01-15T08:30:00Z',
            'audit_logs': [
              {
                'timestamp': '2024-10-28T10:15:00Z',
                'action': 'Đăng nhập ứng dụng',
                'device': 'iPhone 15 Pro',
                'ip_address': '192.168.1.1',
              }
            ],
          },
        }),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    });

    final mockUserService = UserApiService(client: mockClient, token: 'test_token');

    // 1. Build WebAdminApp với initialAuthenticated = true
    await tester.pumpWidget(WebAdminApp(
      initialAuthenticated: true,
      userApiService: mockUserService,
    ));
    await tester.pumpAndSettle();

    // Verify Shell & Branding
    expect(find.text('E-Wallet Admin'), findsOneWidget);
    expect(find.text('Tổng quan Dashboard'), findsWidgets);

    // 2. Verify EXACTLY 5 KPI Cards on Dashboard
    expect(find.text('Tổng số giao dịch'), findsOneWidget);
    expect(find.text('Tổng tiền nạp'), findsOneWidget);
    expect(find.text('Tổng tiền rút'), findsOneWidget);
    expect(find.text('Dòng tiền ròng'), findsOneWidget);
    expect(find.text('Tổng tiền thanh toán QR'), findsOneWidget);

    // Verify Chart Section
    expect(find.text('Biểu đồ Thống kê Dòng tiền & Giao dịch'), findsOneWidget);

    // 3. Test Navigation to Quản lý người dùng
    await tester.tap(find.text('Quản lý người dùng'));
    await tester.pumpAndSettle();

    expect(find.text('Danh sách Người dùng & Hồ sơ Ví'), findsOneWidget);
    expect(find.text('Nguyễn Văn An'), findsOneWidget);

    // Click on User row -> Opens User Detail Drawer (480px)
    await tester.tap(find.text('Nguyễn Văn An'));
    await tester.pumpAndSettle();
    expect(find.text('Hồ sơ Chi tiết Người dùng'), findsOneWidget);
    expect(find.text('SỐ DƯ KHẢ DỤNG VÍ'), findsOneWidget);
    expect(find.text('THÔNG TIN ĐỊNH DANH & BẢO MẬT'), findsOneWidget);
    expect(find.text('Vô hiệu hóa tài khoản'), findsOneWidget);

    // Close Drawer
    await tester.tap(find.byTooltip('Đóng ngăn chi tiết'));
    await tester.pumpAndSettle();
    expect(find.text('Hồ sơ Chi tiết Người dùng'), findsNothing);

    // 4. Test Navigation to Quản lý giao dịch
    await tester.tap(find.text('Quản lý giao dịch'));
    await tester.pumpAndSettle();

    expect(find.text('Sổ Cái Giao Dịch Tài Chính'), findsOneWidget);
    expect(find.text('Xuất Excel'), findsOneWidget);
    expect(find.text('TXN-20241028-98412'), findsOneWidget);

    // Click on Transaction row -> Opens Transaction Detail Page
    await tester.tap(find.text('TXN-20241028-98412'));
    await tester.pumpAndSettle();

    expect(find.text('Chi tiết giao dịch'), findsWidgets);
    expect(find.text('THÔNG TIN CÁC BÊN THAM GIA'), findsOneWidget);
    expect(find.text('TIẾN TRÌNH XỬ LÝ (TIMELINE AUDIT)'), findsOneWidget);

    // Back to transaction list
    await tester.tap(find.text('Danh sách giao dịch'));
    await tester.pumpAndSettle();
    expect(find.text('Sổ Cái Giao Dịch Tài Chính'), findsOneWidget);
  });
}

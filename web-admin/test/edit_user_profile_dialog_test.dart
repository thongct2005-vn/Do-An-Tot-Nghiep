import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:web_admin/features/user/models/user_model.dart';
import 'package:web_admin/features/user/presentation/widgets/edit_user_profile_dialog.dart';

void main() {
  UserModel createTestUser({
    KycStatus kycStatus = KycStatus.verified,
  }) {
    return UserModel(
      id: 'USR-001',
      name: 'Nguyễn Văn An',
      phone: '0912345678',
      email: 'nguyenvanan@gmail.com',
      kycStatus: kycStatus,
      status: UserStatus.active,
      balance: 1000000,
      bankName: 'Vietcombank',
      bankAccount: '123456789',
      dailyLimit: 50000000,
      dailyUsed: 0,
      monthlyLimit: 200000000,
      monthlyUsed: 0,
      createdAt: DateTime(2026, 1, 1),
      auditLogs: [],
    );
  }

  testWidgets('Hiển thị dialog với thông tin ban đầu và cảnh báo KYC khi tài khoản đã KYC',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final user = createTestUser(kycStatus: KycStatus.verified);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () {
                EditUserProfileDialog.show(
                  context,
                  user: user,
                  onSave: ({
                    required String? fullName,
                    required String? phone,
                    required String? email,
                    required String reason,
                  }) async {},
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

    expect(find.text('Chỉnh sửa thông tin người dùng'), findsOneWidget);
    expect(find.text('Nguyễn Văn An'), findsOneWidget);
    expect(find.text('0912345678'), findsOneWidget);
    expect(find.text('nguyenvanan@gmail.com'), findsOneWidget);
    expect(find.textContaining('Tài khoản này đã hoàn tất xác thực định danh (KYC)'), findsOneWidget);
    expect(find.textContaining('thu hồi phiên đăng nhập ngay lập tức'), findsOneWidget);
  });

  testWidgets('Báo lỗi khi nhấn Lưu thay đổi mà chưa chỉnh sửa trường nào',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final user = createTestUser();

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () {
                EditUserProfileDialog.show(
                  context,
                  user: user,
                  onSave: ({
                    required String? fullName,
                    required String? phone,
                    required String? email,
                    required String reason,
                  }) async {},
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

    await tester.tap(find.text('Lưu thay đổi'));
    await tester.pumpAndSettle();

    expect(find.text('Bạn chưa thay đổi bất kỳ trường thông tin nào.'), findsOneWidget);
  });

  testWidgets('Chỉnh sửa thông tin và gọi callback onSave thành công',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final user = createTestUser();
    String? savedName;
    String? savedPhone;
    String? savedEmail;
    String? savedReason;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () {
                EditUserProfileDialog.show(
                  context,
                  user: user,
                  onSave: ({
                    required String? fullName,
                    required String? phone,
                    required String? email,
                    required String reason,
                  }) async {
                    savedName = fullName;
                    savedPhone = phone;
                    savedEmail = email;
                    savedReason = reason;
                  },
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

    // Sửa Họ tên
    final nameField = find.widgetWithText(TextFormField, 'Nguyễn Văn An');
    await tester.enterText(nameField, 'Nguyễn Văn Bình');

    // Nhập Lý do
    final reasonField = find.byType(TextFormField).last;
    await tester.enterText(reasonField, 'Khách hàng đổi tên theo CCCD mới');

    await tester.tap(find.text('Lưu thay đổi'));
    await tester.pumpAndSettle();

    expect(savedName, 'Nguyễn Văn Bình');
    expect(savedPhone, '0912345678');
    expect(savedEmail, 'nguyenvanan@gmail.com');
    expect(savedReason, 'Khách hàng đổi tên theo CCCD mới');
    expect(find.text('Chỉnh sửa thông tin người dùng'), findsNothing);
  });
}

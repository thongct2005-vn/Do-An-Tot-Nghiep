import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:web_admin/core/theme/app_theme.dart';
import 'package:web_admin/features/auth/presentation/login_screen.dart';

void main() {
  group('LoginScreen Widget Tests', () {
    testWidgets('Giao diện hiển thị trường Email quản trị và Mật khẩu ở trạng thái rỗng', (WidgetTester tester) async {
      tester.view.physicalSize = const Size(1440, 900);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.lightTheme,
          home: LoginScreen(onLoginSuccess: (_) {}),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('E-Wallet Admin'), findsOneWidget);
      expect(find.text('Đăng nhập quản trị'), findsOneWidget);
      expect(
        find.byWidgetPredicate((w) => w is RichText && w.text.toPlainText().contains('Email quản trị')),
        findsOneWidget,
      );
      expect(
        find.byWidgetPredicate((w) => w is RichText && w.text.toPlainText().contains('Mật khẩu')),
        findsWidgets,
      );
      expect(find.text('email@ewallet.com'), findsOneWidget); // placeholder
      expect(find.text('Nhập mật khẩu'), findsOneWidget); // placeholder
      expect(find.text('Đăng nhập'), findsOneWidget);
    });

    testWidgets('TC-07: Chặn gửi request và hiển thị lỗi inline khi để trống dữ liệu', (WidgetTester tester) async {
      tester.view.physicalSize = const Size(1440, 900);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.lightTheme,
          home: LoginScreen(onLoginSuccess: (_) {}),
        ),
      );
      await tester.pumpAndSettle();

      // Tap Đăng nhập khi form rỗng
      await tester.tap(find.text('Đăng nhập'));
      await tester.pumpAndSettle();

      expect(find.text('Vui lòng nhập email quản trị'), findsOneWidget);
      expect(find.text('Vui lòng nhập mật khẩu'), findsOneWidget);
      expect(
        find.text('Không thể bỏ trống thông tin: Vui lòng điền đầy đủ email và mật khẩu quản trị.'),
        findsOneWidget,
      );
    });

    testWidgets('TC-06: Chặn gửi request và hiển thị lỗi khi email sai định dạng', (WidgetTester tester) async {
      tester.view.physicalSize = const Size(1440, 900);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.lightTheme,
          home: LoginScreen(onLoginSuccess: (_) {}),
        ),
      );
      await tester.pumpAndSettle();

      // Nhập email sai định dạng
      final emailField = find.byType(TextField).first;
      await tester.enterText(emailField, 'email_sai_dinh_dang');

      // Nhập mật khẩu
      final passwordField = find.byType(TextField).last;
      await tester.enterText(passwordField, '123456');

      // Tap Đăng nhập
      await tester.tap(find.text('Đăng nhập'));
      await tester.pumpAndSettle();

      expect(find.text('Định dạng email không hợp lệ'), findsWidgets);
    });
  });
}

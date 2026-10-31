import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:web_admin/app.dart';
import 'package:web_admin/features/auth/data/auth_api_service.dart';
import 'package:web_admin/features/auth/data/auth_storage_service.dart';
import 'package:web_admin/features/auth/models/admin_session_model.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('AuthStorageService Unit Tests', () {
    final sampleSession = AdminSessionModel(
      accessToken: 'sample_access_jwt',
      refreshToken: 'sample_refresh_jwt',
      adminInfo: AdminInfo(
        userId: 'admin-uuid-1234',
        email: 'admin@ewallet.com',
        fullName: 'Admin Tổng',
        role: 'ADMIN',
      ),
    );

    test('Lưu phiên (saveSession) và đọc lại phiên (getSession) thành công', () async {
      final storage = AuthStorageService();

      // Ban đầu chưa có dữ liệu
      final initialSession = await storage.getSession();
      expect(initialSession, isNull);

      // Lưu phiên
      await storage.saveSession(sampleSession);

      // Đọc lại phiên
      final loadedSession = await storage.getSession();
      expect(loadedSession, isNotNull);
      expect(loadedSession!.accessToken, 'sample_access_jwt');
      expect(loadedSession.refreshToken, 'sample_refresh_jwt');
      expect(loadedSession.adminInfo.userId, 'admin-uuid-1234');
      expect(loadedSession.adminInfo.email, 'admin@ewallet.com');
      expect(loadedSession.adminInfo.fullName, 'Admin Tổng');
      expect(loadedSession.adminInfo.role, 'ADMIN');
    });

    test('Xóa phiên (clearSession) làm sạch dữ liệu trong LocalStorage', () async {
      final storage = AuthStorageService();

      await storage.saveSession(sampleSession);
      var session = await storage.getSession();
      expect(session, isNotNull);

      await storage.clearSession();
      session = await storage.getSession();
      expect(session, isNull);
    });

    test('Xử lý an toàn khi JSON trong storage bị hỏng hoặc thiếu trường', () async {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('admin_session_data', '{corrupted_json_string}');

      final storage = AuthStorageService(prefs: prefs);
      final session = await storage.getSession();

      expect(session, isNull);
      // Đảm bảo dữ liệu hỏng đã được dọn sạch
      expect(prefs.containsKey('admin_session_data'), isFalse);
    });
  });

  group('AuthApiService - getMe, refreshToken, logout Unit Tests', () {
    test('getMe: Trả về AdminInfo khi token hợp lệ (200 OK)', () async {
      final mockClient = MockClient((request) async {
        expect(request.method, 'GET');
        expect(request.url.path, '/api/v2/admin/auth/me');
        expect(request.headers['Authorization'], 'Bearer valid_admin_token');

        return http.Response(
          jsonEncode({
            'status': 'success',
            'code': 200,
            'data': {
              'admin_info': {
                'user_id': 'admin-uuid-1234',
                'email': 'admin@ewallet.com',
                'full_name': 'Admin Quản Trị Viên',
                'role': 'ADMIN',
              },
            },
          }),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      });

      final service = AuthApiService(client: mockClient);
      final admin = await service.getMe(accessToken: 'valid_admin_token');

      expect(admin.userId, 'admin-uuid-1234');
      expect(admin.email, 'admin@ewallet.com');
      expect(admin.fullName, 'Admin Quản Trị Viên');
      expect(admin.role, 'ADMIN');
    });

    test('getMe: Quăng AuthApiException khi token không hợp lệ hoặc hết hạn (401 Unauthorized)', () async {
      final mockClient = MockClient((request) async {
        return http.Response(
          jsonEncode({
            'status': 'error',
            'code': 401,
            'message': 'Token không hợp lệ hoặc đã hết hạn',
          }),
          401,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      });

      final service = AuthApiService(client: mockClient);

      expect(
        () => service.getMe(accessToken: 'expired_token'),
        throwsA(isA<AuthApiException>().having((e) => e.statusCode, 'statusCode', 401)),
      );
    });

    test('refreshToken: Trả về cặp token mới khi refresh_token hợp lệ (200 OK)', () async {
      final mockClient = MockClient((request) async {
        expect(request.method, 'POST');
        expect(request.url.path, '/api/v2/admin/auth/refresh-token');

        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['refresh_token'], 'valid_refresh_token');

        return http.Response(
          jsonEncode({
            'status': 'success',
            'code': 200,
            'data': {
              'token': {
                'access_token': 'new_access_token',
                'refresh_token': 'new_refresh_token',
              },
            },
          }),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      });

      final service = AuthApiService(client: mockClient);
      final tokens = await service.refreshToken(refreshToken: 'valid_refresh_token');

      expect(tokens['access_token'], 'new_access_token');
      expect(tokens['refresh_token'], 'new_refresh_token');
    });

    test('refreshToken: Quăng AuthApiException khi refresh_token hết hạn (401 Unauthorized)', () async {
      final mockClient = MockClient((request) async {
        return http.Response(
          jsonEncode({
            'status': 'error',
            'code': 401,
            'message': 'Refresh token không hợp lệ hoặc đã hết hạn',
          }),
          401,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      });

      final service = AuthApiService(client: mockClient);

      expect(
        () => service.refreshToken(refreshToken: 'expired_refresh_token'),
        throwsA(isA<AuthApiException>().having((e) => e.statusCode, 'statusCode', 401)),
      );
    });

    test('logout: Gửi yêu cầu đăng xuất không quăng lỗi ngay cả khi mất mạng', () async {
      final mockClient = MockClient((request) async {
        expect(request.method, 'POST');
        expect(request.url.path, '/api/v2/admin/auth/logout');
        expect(request.headers['Authorization'], 'Bearer any_token');
        return http.Response('{"status":"success"}', 200);
      });

      final service = AuthApiService(client: mockClient);
      await service.logout(accessToken: 'any_token');
      // Không ném ngoại lệ
    });
  });

  group('WebAdminApp Session Hydration (F5) Tests', () {
    testWidgets('Tự động khôi phục phiên khi F5 và vào thẳng Dashboard (Session Hydration)', (WidgetTester tester) async {
      tester.view.physicalSize = const Size(1440, 900);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      // Cài đặt trước phiên đã đăng nhập trong Storage
      final session = AdminSessionModel(
        accessToken: 'saved_access_token',
        refreshToken: 'saved_refresh_token',
        adminInfo: AdminInfo(
          userId: 'admin-1',
          email: 'admin@ewallet.com',
          fullName: 'Nguyễn Quản Trị',
          role: 'ADMIN',
        ),
      );
      final storage = AuthStorageService();
      await storage.saveSession(session);

      final mockClient = MockClient((request) async {
        if (request.url.path.contains('/api/v2/admin/auth/me')) {
          return http.Response(
            jsonEncode({
              'status': 'success',
              'code': 200,
              'data': {
                'admin_info': {
                  'user_id': 'admin-1',
                  'email': 'admin@ewallet.com',
                  'full_name': 'Nguyễn Quản Trị',
                  'role': 'ADMIN',
                },
              },
            }),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }
        return http.Response('{"status":"success","data":{}}', 200);
      });

      final authApi = AuthApiService(client: mockClient);

      // Khởi động WebAdminApp giống như khi người dùng vừa F5 reload trang
      await tester.pumpWidget(WebAdminApp(
        initialAuthenticated: false,
        authStorageService: storage,
        authApiService: authApi,
      ));

      await tester.pumpAndSettle();

      // Đã khôi phục thành công -> Hiển thị Dashboard mà không bắt đăng nhập lại
      expect(find.text('Tổng quan Dashboard'), findsWidgets);
      expect(find.text('Nguyễn Quản Trị'), findsOneWidget);
    });

    testWidgets('Tự động gia hạn ngầm (silent refresh) khi access token hết hạn lúc F5', (WidgetTester tester) async {
      tester.view.physicalSize = const Size(1440, 900);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final session = AdminSessionModel(
        accessToken: 'expired_access_token',
        refreshToken: 'valid_refresh_token',
        adminInfo: AdminInfo(
          userId: 'admin-1',
          email: 'admin@ewallet.com',
          fullName: 'Nguyễn Quản Trị',
          role: 'ADMIN',
        ),
      );
      final storage = AuthStorageService();
      await storage.saveSession(session);

      var meCallCount = 0;
      final mockClient = MockClient((request) async {
        if (request.url.path.contains('/api/v2/admin/auth/me')) {
          meCallCount++;
          if (meCallCount == 1) {
            // Lần gọi đầu với expired_access_token trả lời 401
            return http.Response(
              jsonEncode({
                'status': 'error',
                'code': 401,
                'message': 'Token expired',
              }),
              401,
              headers: {'content-type': 'application/json; charset=utf-8'},
            );
          } else {
            // Lần gọi thứ 2 với new_access_token thành công
            return http.Response(
              jsonEncode({
                'status': 'success',
                'code': 200,
                'data': {
                  'admin_info': {
                    'user_id': 'admin-1',
                    'email': 'admin@ewallet.com',
                    'full_name': 'Nguyễn Quản Trị Refreshed',
                    'role': 'ADMIN',
                  },
                },
              }),
              200,
              headers: {'content-type': 'application/json; charset=utf-8'},
            );
          }
        }
        if (request.url.path.contains('/api/v2/admin/auth/refresh-token')) {
          return http.Response(
            jsonEncode({
              'status': 'success',
              'code': 200,
              'data': {
                'token': {
                  'access_token': 'new_access_token',
                  'refresh_token': 'new_refresh_token',
                },
              },
            }),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }
        return http.Response('{"status":"success","data":{}}', 200);
      });

      final authApi = AuthApiService(client: mockClient);

      await tester.pumpWidget(WebAdminApp(
        initialAuthenticated: false,
        authStorageService: storage,
        authApiService: authApi,
      ));

      await tester.pumpAndSettle();

      // Vào Dashboard thành công sau khi refresh
      expect(find.text('Tổng quan Dashboard'), findsWidgets);
      expect(find.text('Nguyễn Quản Trị Refreshed'), findsOneWidget);

      // Kiểm tra storage đã được cập nhật token mới
      final updatedSession = await storage.getSession();
      expect(updatedSession?.accessToken, 'new_access_token');
      expect(updatedSession?.refreshToken, 'new_refresh_token');
    });

    testWidgets('Xóa storage và về LoginScreen khi cả access token và refresh token đều hết hạn', (WidgetTester tester) async {
      tester.view.physicalSize = const Size(1440, 900);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final session = AdminSessionModel(
        accessToken: 'expired_access_token',
        refreshToken: 'expired_refresh_token',
        adminInfo: AdminInfo(
          userId: 'admin-1',
          email: 'admin@ewallet.com',
          fullName: 'Nguyễn Quản Trị',
          role: 'ADMIN',
        ),
      );
      final storage = AuthStorageService();
      await storage.saveSession(session);

      final mockClient = MockClient((request) async {
        return http.Response(
          jsonEncode({
            'status': 'error',
            'code': 401,
            'message': 'Token invalid or expired',
          }),
          401,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      });

      final authApi = AuthApiService(client: mockClient);

      await tester.pumpWidget(WebAdminApp(
        initialAuthenticated: false,
        authStorageService: storage,
        authApiService: authApi,
      ));

      await tester.pumpAndSettle();

      // Hiển thị màn hình Login
      expect(find.text('Đăng nhập'), findsOneWidget);
      expect(find.text('E-Wallet Admin'), findsOneWidget);

      // Storage đã bị xóa sạch
      final remainingSession = await storage.getSession();
      expect(remainingSession, isNull);
    });
  });
}

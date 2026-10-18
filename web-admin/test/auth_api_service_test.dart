import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:web_admin/features/auth/data/auth_api_service.dart';

void main() {
  group('AuthApiService - Kịch bản kiểm thử API Login Admin', () {
    test('TC-01: Đăng nhập thành công với tài khoản ADMIN (200 OK)', () async {
      final mockClient = MockClient((request) async {
        expect(request.method, 'POST');
        expect(request.url.path, '/api/v2/admin/auth/login');

        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['email'], 'admin@ewallet.com');
        expect(body['password'], '123456');

        return http.Response(
          jsonEncode({
            'status': 'success',
            'code': 200,
            'message': 'Đăng nhập Admin thành công',
            'data': {
              'token': {
                'access_token': 'mock_access_token_jwt',
                'refresh_token': 'mock_refresh_token_jwt',
              },
              'admin_info': {
                'user_id': '04c78791-4622-4b41-a1bf-9a3beb3aeb04',
                'email': 'admin@ewallet.com',
                'full_name': 'Administrator',
                'role': 'ADMIN',
              },
            },
          }),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      });

      final service = AuthApiService(client: mockClient);
      final session = await service.login(
        email: 'admin@ewallet.com',
        password: '123456',
      );

      expect(session.accessToken, 'mock_access_token_jwt');
      expect(session.refreshToken, 'mock_refresh_token_jwt');
      expect(session.adminInfo.userId, '04c78791-4622-4b41-a1bf-9a3beb3aeb04');
      expect(session.adminInfo.email, 'admin@ewallet.com');
      expect(session.adminInfo.fullName, 'Administrator');
      expect(session.adminInfo.role, 'ADMIN');
    });

    test('TC-02: Sai mật khẩu (400 Bad Request) - trả về số lần thử còn lại', () async {
      final mockClient = MockClient((request) async {
        return http.Response(
          jsonEncode({
            'status': 'error',
            'code': 400,
            'message': 'Mật khẩu không chính xác',
            'remainingAttempts': 4,
          }),
          400,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      });

      final service = AuthApiService(client: mockClient);

      expect(
        () => service.login(email: 'admin@ewallet.com', password: 'wrongpassword'),
        throwsA(
          isA<AuthApiException>()
              .having((e) => e.statusCode, 'statusCode', 400)
              .having((e) => e.remainingAttempts, 'remainingAttempts', 4)
              .having((e) => e.message, 'message', contains('Còn 4 lần thử')),
        ),
      );
    });

    test('TC-03: Tài khoản bị tạm khóa 30 phút sau 5 lần nhập sai (403 Forbidden)', () async {
      final mockClient = MockClient((request) async {
        return http.Response(
          jsonEncode({
            'status': 'error',
            'code': 403,
            'message': 'Tài khoản bị tạm khóa',
          }),
          403,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      });

      final service = AuthApiService(client: mockClient);

      expect(
        () => service.login(email: 'admin@ewallet.com', password: 'wrongpassword'),
        throwsA(
          isA<AuthApiException>()
              .having((e) => e.statusCode, 'statusCode', 403)
              .having((e) => e.message, 'message', 'Tài khoản bị tạm khóa'),
        ),
      );
    });

    test('TC-04: Từ chối tài khoản role USER (403 Forbidden)', () async {
      final mockClient = MockClient((request) async {
        return http.Response(
          jsonEncode({
            'status': 'error',
            'code': 403,
            'message': 'Tài khoản không có quyền Quản trị viên',
          }),
          403,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      });

      final service = AuthApiService(client: mockClient);

      expect(
        () => service.login(email: 'thongpvt003@gmail.com', password: '123456'),
        throwsA(
          isA<AuthApiException>()
              .having((e) => e.statusCode, 'statusCode', 403)
              .having((e) => e.message, 'message', 'Tài khoản không có quyền Quản trị viên'),
        ),
      );
    });

    test('TC-05: Tài khoản không tồn tại trong hệ thống (404 Not Found)', () async {
      final mockClient = MockClient((request) async {
        return http.Response(
          jsonEncode({
            'status': 'error',
            'code': 404,
            'message': 'Tài khoản không tồn tại',
          }),
          404,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      });

      final service = AuthApiService(client: mockClient);

      expect(
        () => service.login(email: 'notfound@ewallet.com', password: '123456'),
        throwsA(
          isA<AuthApiException>()
              .having((e) => e.statusCode, 'statusCode', 404)
              .having((e) => e.message, 'message', 'Tài khoản không tồn tại'),
        ),
      );
    });

    test('TC-08: Vượt quá tần suất thao tác (429 Too Many Requests)', () async {
      final mockClient = MockClient((request) async {
        return http.Response(
          jsonEncode({
            'status': 'error',
            'code': 429,
            'message': 'Bạn thao tác quá nhiều lần, vui lòng thử lại sau',
          }),
          429,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      });

      final service = AuthApiService(client: mockClient);

      expect(
        () => service.login(email: 'admin@ewallet.com', password: '123456'),
        throwsA(
          isA<AuthApiException>()
              .having((e) => e.statusCode, 'statusCode', 429)
              .having((e) => e.message, 'message', 'Bạn thao tác quá nhiều lần, vui lòng thử lại sau'),
        ),
      );
    });

    test('Lỗi mất kết nối mạng / server backend không phản hồi', () async {
      final mockClient = MockClient((request) async {
        throw http.ClientException('Connection refused');
      });

      final service = AuthApiService(client: mockClient);

      expect(
        () => service.login(email: 'admin@ewallet.com', password: '123456'),
        throwsA(
          isA<AuthApiException>()
              .having((e) => e.statusCode, 'statusCode', 0)
              .having((e) => e.message, 'message', contains('Không thể kết nối đến máy chủ quản trị')),
        ),
      );
    });
  });
}

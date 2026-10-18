import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:web_admin/features/user/data/user_api_service.dart';
import 'package:web_admin/features/user/models/user_model.dart';

void main() {
  group('UserApiService - Kịch bản kiểm thử API Quản lý Người dùng Admin', () {
    const testToken = 'mock_admin_access_token_jwt';

    test('TC-01: Lấy thống kê số lượng người dùng thành công (200 OK)', () async {
      final mockClient = MockClient((request) async {
        expect(request.method, 'GET');
        expect(request.url.path, '/api/v2/admin/user/stats');
        expect(request.headers['Authorization'], 'Bearer $testToken');

        return http.Response(
          jsonEncode({
            'status': 'success',
            'code': 200,
            'message': 'Thống kê người dùng',
            'data': {
              'total_users': 15,
              'active_users': 13,
              'suspended_users': 2,
            },
          }),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      });

      final service = UserApiService(client: mockClient, token: testToken);
      final stats = await service.getStats();

      expect(stats.totalUsers, 15);
      expect(stats.activeUsers, 13);
      expect(stats.suspendedUsers, 2);
    });

    test('TC-02: Lấy danh sách người dùng phân trang và tìm kiếm (200 OK)', () async {
      final mockClient = MockClient((request) async {
        expect(request.method, 'GET');
        expect(request.url.path, '/api/v2/admin/user');
        expect(request.url.queryParameters['page'], '1');
        expect(request.url.queryParameters['limit'], '10');
        expect(request.url.queryParameters['search'], 'Dương Gian');
        expect(request.url.queryParameters['status'], 'ACTIVE');
        expect(request.headers['Authorization'], 'Bearer $testToken');

        return http.Response(
          jsonEncode({
            'status': 'success',
            'code': 200,
            'message': 'Danh sách người dùng',
            'data': {
              'items': [
                {
                  'id': '019f4b7a-1ef3-736c-ba4e-077b9ce03b59',
                  'full_name': 'Dương Gian',
                  'phone': '0901234567',
                  'email': 'duonggian@gmail.com',
                  'balance': 2500000,
                  'status': 'ACTIVE',
                  'kyc_status': 'APPROVED',
                  'bank_name': 'Vietcombank',
                  'bank_account': '9876543210',
                  'created_at': '2026-03-01T10:00:00Z',
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
      });

      final service = UserApiService(client: mockClient, token: testToken);
      final result = await service.getUsers(
        page: 1,
        limit: 10,
        search: 'Dương Gian',
        status: 'ACTIVE',
      );

      expect(result.totalItems, 1);
      expect(result.totalPages, 1);
      expect(result.currentPage, 1);
      expect(result.limit, 10);
      expect(result.items.length, 1);

      final user = result.items.first;
      expect(user.id, '019f4b7a-1ef3-736c-ba4e-077b9ce03b59');
      expect(user.name, 'Dương Gian');
      expect(user.phone, '0901234567');
      expect(user.email, 'duonggian@gmail.com');
      expect(user.balance, 2500000);
      expect(user.status, UserStatus.active);
      expect(user.kycStatus, KycStatus.verified);
      expect(user.bankName, 'Vietcombank');
      expect(user.bankAccount, '9876543210');
    });

    test('TC-03: Lấy chi tiết toàn diện 1 người dùng thành công (200 OK)', () async {
      final mockClient = MockClient((request) async {
        expect(request.method, 'GET');
        expect(request.url.path, '/api/v2/admin/user/019f4b7a-1ef3-736c-ba4e-077b9ce03b59');
        expect(request.headers['Authorization'], 'Bearer $testToken');

        return http.Response(
          jsonEncode({
            'status': 'success',
            'code': 200,
            'message': 'Chi tiết người dùng',
            'data': {
              'id': '019f4b7a-1ef3-736c-ba4e-077b9ce03b59',
              'name': 'Dương Gian',
              'phone': '0901234567',
              'email': 'duonggian@gmail.com',
              'balance': 2500000,
              'status': 'ACTIVE',
              'kyc_status': 'APPROVED',
              'kyc': {
                'cccd_number': '001201012345',
                'dob': '2001-01-01',
                'gender': 'Nam',
                'address': 'Hà Nội',
                'status': 'APPROVED',
              },
              'linked_banks': [
                {
                  'bank_name': 'Vietcombank',
                  'account_number': '9876543210',
                  'is_default': true,
                }
              ],
              'audit_logs': [
                {
                  'timestamp': '2026-03-01T10:00:00Z',
                  'action': 'Đăng nhập thành công',
                  'device': 'iPhone 15 Pro',
                  'ip_address': '192.168.1.10',
                }
              ],
            },
          }),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      });

      final service = UserApiService(client: mockClient, token: testToken);
      final user = await service.getUserDetail('019f4b7a-1ef3-736c-ba4e-077b9ce03b59');

      expect(user.id, '019f4b7a-1ef3-736c-ba4e-077b9ce03b59');
      expect(user.name, 'Dương Gian');
      expect(user.kycStatus, KycStatus.verified);
      expect(user.kycDetail?.cccdNumber, '001201012345');
      expect(user.kycDetail?.gender, 'Nam');
      expect(user.kycDetail?.address, 'Hà Nội');
      expect(user.bankName, 'Vietcombank');
      expect(user.auditLogs.length, 1);
      expect(user.auditLogs.first.action, 'Đăng nhập thành công');
      expect(user.auditLogs.first.device, 'iPhone 15 Pro');
    });

    test('TC-04: Cập nhật trạng thái người dùng (PATCH BLOCKED) thành công', () async {
      final mockClient = MockClient((request) async {
        expect(request.method, 'PATCH');
        expect(request.url.path, '/api/v2/admin/user/019f4b7a-1ef3-736c-ba4e-077b9ce03b59/status');
        expect(request.headers['Authorization'], 'Bearer $testToken');

        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['status'], 'BLOCKED');
        expect(body['reason'], 'Phát hiện hành vi gian lận');

        return http.Response(
          jsonEncode({
            'status': 'success',
            'code': 200,
            'message': 'Cập nhật trạng thái người dùng thành công',
          }),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      });

      final service = UserApiService(client: mockClient, token: testToken);
      await expectLater(
        service.updateUserStatus(
          id: '019f4b7a-1ef3-736c-ba4e-077b9ce03b59',
          status: 'BLOCKED',
          reason: 'Phát hiện hành vi gian lận',
        ),
        completes,
      );
    });

    test('TC-05: Lỗi 404 khi người dùng không tồn tại', () async {
      final mockClient = MockClient((request) async {
        return http.Response(
          jsonEncode({
            'status': 'error',
            'code': 404,
            'message': 'Người dùng không tồn tại trong hệ thống',
          }),
          404,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      });

      final service = UserApiService(client: mockClient, token: testToken);
      expect(
        () => service.getUserDetail('invalid-uuid'),
        throwsA(
          isA<UserApiException>().having(
            (e) => e.message,
            'message',
            contains('Người dùng không tồn tại'),
          ),
        ),
      );
    });

    test('TC-06: Lỗi khi mất kết nối máy chủ', () async {
      final mockClient = MockClient((request) async {
        throw Exception('Connection refused');
      });

      final service = UserApiService(client: mockClient, token: testToken);
      expect(
        () => service.getStats(),
        throwsA(
          isA<UserApiException>().having(
            (e) => e.message,
            'message',
            contains('Không thể kết nối đến máy chủ quản trị'),
          ),
        ),
      );
    });
  });
}

import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../../core/network/api_constants.dart';
import '../models/admin_session_model.dart';

class AuthApiException implements Exception {
  final String message;
  final int? statusCode;
  final int? remainingAttempts;

  const AuthApiException(
    this.message, {
    this.statusCode,
    this.remainingAttempts,
  });

  @override
  String toString() => message;
}

class AuthApiService {
  final http.Client _client;

  AuthApiService({http.Client? client}) : _client = client ?? http.Client();

  /// Gửi yêu cầu đăng nhập Quản trị viên
  Future<AdminSessionModel> login({
    required String email,
    required String password,
  }) async {
    final uri = Uri.parse(ApiConstants.adminLogin);

    final http.Response response;
    try {
      response = await _client.post(
        uri,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: jsonEncode({
          'email': email,
          'password': password,
        }),
      );
    } catch (e) {
      throw const AuthApiException(
        'Không thể kết nối đến máy chủ quản trị. Vui lòng kiểm tra lại dịch vụ Backend.',
        statusCode: 0,
      );
    }

    final dynamic body;
    try {
      body = jsonDecode(utf8.decode(response.bodyBytes));
    } catch (_) {
      throw AuthApiException(
        'Phản hồi từ máy chủ không hợp lệ (${response.statusCode})',
        statusCode: response.statusCode,
      );
    }

    final statusCode = response.statusCode;

    if (statusCode >= 200 && statusCode < 300) {
      if (body is Map<String, dynamic> && body['data'] != null) {
        return AdminSessionModel.fromJson(body['data'] as Map<String, dynamic>);
      }
      throw const AuthApiException(
        'Dữ liệu phản hồi đăng nhập thiếu thông tin xác thực',
        statusCode: 200,
      );
    }

    // Xử lý các mã lỗi HTTP từ backend
    String errorMessage = 'Đã có lỗi xảy ra ($statusCode)';
    int? remainingAttempts;

    if (body is Map<String, dynamic>) {
      if (body['message'] != null && body['message'].toString().isNotEmpty) {
        errorMessage = body['message'].toString();
      }
      if (body['remainingAttempts'] != null) {
        remainingAttempts = int.tryParse(body['remainingAttempts'].toString());
      }
    }

    if (remainingAttempts != null && remainingAttempts > 0) {
      errorMessage = '$errorMessage (Còn $remainingAttempts lần thử)';
    }

    throw AuthApiException(
      errorMessage,
      statusCode: statusCode,
      remainingAttempts: remainingAttempts,
    );
  }

  /// Lấy thông tin Quản trị viên hiện tại (Xác thực phiên làm việc)
  Future<AdminInfo> getMe({required String accessToken}) async {
    final uri = Uri.parse(ApiConstants.adminMe);

    final http.Response response;
    try {
      response = await _client.get(
        uri,
        headers: {
          'Authorization': 'Bearer $accessToken',
          'Accept': 'application/json',
        },
      );
    } catch (e) {
      throw const AuthApiException(
        'Không thể kết nối đến máy chủ quản trị.',
        statusCode: 0,
      );
    }

    final dynamic body;
    try {
      body = jsonDecode(utf8.decode(response.bodyBytes));
    } catch (_) {
      throw AuthApiException(
        'Phản hồi từ máy chủ không hợp lệ (${response.statusCode})',
        statusCode: response.statusCode,
      );
    }

    if (response.statusCode >= 200 && response.statusCode < 300) {
      if (body is Map<String, dynamic> &&
          body['data'] != null &&
          body['data']['admin_info'] != null) {
        return AdminInfo.fromJson(
            body['data']['admin_info'] as Map<String, dynamic>);
      }
      throw const AuthApiException(
        'Dữ liệu phản hồi thiếu thông tin Quản trị viên',
        statusCode: 200,
      );
    }

    final String message =
        (body is Map<String, dynamic> && body['message'] != null)
            ? body['message'].toString()
            : 'Lỗi xác thực phiên (${response.statusCode})';

    throw AuthApiException(message, statusCode: response.statusCode);
  }

  /// Cấp lại Access Token và Refresh Token mới
  Future<Map<String, String>> refreshToken({
    required String refreshToken,
  }) async {
    final uri = Uri.parse(ApiConstants.adminRefreshToken);

    final http.Response response;
    try {
      response = await _client.post(
        uri,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: jsonEncode({'refresh_token': refreshToken}),
      );
    } catch (e) {
      throw const AuthApiException(
        'Không thể kết nối đến máy chủ để gia hạn phiên.',
        statusCode: 0,
      );
    }

    final dynamic body;
    try {
      body = jsonDecode(utf8.decode(response.bodyBytes));
    } catch (_) {
      throw AuthApiException(
        'Phản hồi từ máy chủ không hợp lệ (${response.statusCode})',
        statusCode: response.statusCode,
      );
    }

    if (response.statusCode >= 200 && response.statusCode < 300) {
      if (body is Map<String, dynamic> &&
          body['data'] != null &&
          body['data']['token'] != null) {
        final token = body['data']['token'] as Map<String, dynamic>;
        return {
          'access_token': token['access_token']?.toString() ?? '',
          'refresh_token': token['refresh_token']?.toString() ?? '',
        };
      }
      throw const AuthApiException(
        'Dữ liệu phản hồi thiếu token mới',
        statusCode: 200,
      );
    }

    final String message =
        (body is Map<String, dynamic> && body['message'] != null)
            ? body['message'].toString()
            : 'Gia hạn phiên thất bại (${response.statusCode})';

    throw AuthApiException(message, statusCode: response.statusCode);
  }

  /// Gửi yêu cầu đăng xuất để vô hiệu hóa phiên ở Server
  Future<void> logout({required String accessToken}) async {
    final uri = Uri.parse(ApiConstants.adminLogout);
    try {
      await _client.post(
        uri,
        headers: {
          'Authorization': 'Bearer $accessToken',
          'Accept': 'application/json',
        },
      );
    } catch (_) {
      // Bỏ qua lỗi kết nối khi logout
    }
  }
}

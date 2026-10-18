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
}

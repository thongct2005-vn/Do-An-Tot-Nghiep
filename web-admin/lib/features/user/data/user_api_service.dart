import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../../core/network/api_constants.dart';
import '../models/user_model.dart';

class UserApiException implements Exception {
  final String message;
  final int? statusCode;

  const UserApiException(this.message, {this.statusCode});

  @override
  String toString() => message;
}

class UserPaginatedResult {
  final List<UserModel> items;
  final int totalItems;
  final int totalPages;
  final int currentPage;
  final int limit;

  const UserPaginatedResult({
    required this.items,
    required this.totalItems,
    required this.totalPages,
    required this.currentPage,
    required this.limit,
  });
}

class UserApiService {
  static String? defaultToken;
  final http.Client _client;
  final String? token;

  UserApiService({http.Client? client, this.token})
      : _client = client ?? http.Client();

  String? get _effectiveToken => token ?? defaultToken;

  Map<String, String> get _headers {
    final headers = <String, String>{
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    final t = _effectiveToken;
    if (t != null && t.isNotEmpty) {
      headers['Authorization'] = 'Bearer $t';
    }
    return headers;
  }

  /// Lấy thống kê số lượng người dùng
  Future<UserStats> getStats() async {
    final uri = Uri.parse(ApiConstants.adminUserStats);
    final http.Response response;
    try {
      response = await _client.get(uri, headers: _headers);
    } catch (e) {
      throw const UserApiException(
        'Không thể kết nối đến máy chủ quản trị.',
        statusCode: 0,
      );
    }

    final dynamic body;
    try {
      body = jsonDecode(utf8.decode(response.bodyBytes));
    } catch (_) {
      throw UserApiException(
        'Phản hồi không hợp lệ (${response.statusCode})',
        statusCode: response.statusCode,
      );
    }

    if (response.statusCode >= 200 && response.statusCode < 300) {
      if (body is Map<String, dynamic> && body['data'] is Map<String, dynamic>) {
        return UserStats.fromJson(body['data'] as Map<String, dynamic>);
      }
      throw const UserApiException('Dữ liệu thống kê không hợp lệ');
    }

    final msg = body is Map<String, dynamic> ? body['message']?.toString() : null;
    throw UserApiException(
      msg ?? 'Lỗi tải thống kê (${response.statusCode})',
      statusCode: response.statusCode,
    );
  }

  /// Lấy danh sách người dùng phân trang và tìm kiếm
  Future<UserPaginatedResult> getUsers({
    int page = 1,
    int limit = 10,
    String? search,
    String? status,
  }) async {
    final queryParams = <String, String>{
      'page': page.toString(),
      'limit': limit.toString(),
    };
    if (search != null && search.trim().isNotEmpty) {
      queryParams['search'] = search.trim();
    }
    if (status != null && status != 'ALL') {
      queryParams['status'] = status;
    }

    final uri =
        Uri.parse(ApiConstants.adminUsers).replace(queryParameters: queryParams);
    final http.Response response;
    try {
      response = await _client.get(uri, headers: _headers);
    } catch (e) {
      throw const UserApiException(
        'Không thể kết nối đến máy chủ quản trị.',
        statusCode: 0,
      );
    }

    final dynamic body;
    try {
      body = jsonDecode(utf8.decode(response.bodyBytes));
    } catch (_) {
      throw UserApiException(
        'Phản hồi không hợp lệ (${response.statusCode})',
        statusCode: response.statusCode,
      );
    }

    if (response.statusCode >= 200 && response.statusCode < 300) {
      if (body is Map<String, dynamic> && body['data'] is Map<String, dynamic>) {
        final data = body['data'] as Map<String, dynamic>;
        final itemsRaw = data['items'] as List<dynamic>? ?? [];
        final pagination = data['pagination'] as Map<String, dynamic>? ?? {};

        final items = itemsRaw
            .whereType<Map<String, dynamic>>()
            .map((item) => UserModel.fromJson(item))
            .toList();

        return UserPaginatedResult(
          items: items,
          totalItems: int.tryParse(pagination['total_items']?.toString() ?? '') ??
              items.length,
          totalPages:
              int.tryParse(pagination['total_pages']?.toString() ?? '') ?? 1,
          currentPage:
              int.tryParse(pagination['current_page']?.toString() ?? '') ?? page,
          limit: int.tryParse(pagination['limit']?.toString() ?? '') ?? limit,
        );
      }
      throw const UserApiException('Dữ liệu danh sách người dùng không hợp lệ');
    }

    final msg = body is Map<String, dynamic> ? body['message']?.toString() : null;
    throw UserApiException(
      msg ?? 'Lỗi tải danh sách người dùng (${response.statusCode})',
      statusCode: response.statusCode,
    );
  }

  /// Lấy chi tiết toàn diện 1 người dùng
  Future<UserModel> getUserDetail(String id) async {
    final uri = Uri.parse(ApiConstants.adminUserDetail(id));
    final http.Response response;
    try {
      response = await _client.get(uri, headers: _headers);
    } catch (e) {
      throw const UserApiException(
        'Không thể kết nối đến máy chủ quản trị.',
        statusCode: 0,
      );
    }

    final dynamic body;
    try {
      body = jsonDecode(utf8.decode(response.bodyBytes));
    } catch (_) {
      throw UserApiException(
        'Phản hồi không hợp lệ (${response.statusCode})',
        statusCode: response.statusCode,
      );
    }

    if (response.statusCode >= 200 && response.statusCode < 300) {
      if (body is Map<String, dynamic> && body['data'] is Map<String, dynamic>) {
        return UserModel.fromJson(body['data'] as Map<String, dynamic>);
      }
      throw const UserApiException('Dữ liệu chi tiết người dùng không hợp lệ');
    }

    final msg = body is Map<String, dynamic> ? body['message']?.toString() : null;
    throw UserApiException(
      msg ?? 'Lỗi tải chi tiết người dùng (${response.statusCode})',
      statusCode: response.statusCode,
    );
  }

  /// Cập nhật trạng thái người dùng (ACTIVE / BLOCKED)
  Future<void> updateUserStatus({
    required String id,
    required String status,
    String? reason,
  }) async {
    final uri = Uri.parse(ApiConstants.adminUserStatus(id));
    final http.Response response;
    try {
      response = await _client.patch(
        uri,
        headers: _headers,
        body: jsonEncode({
          'status': status,
          if (reason != null && reason.trim().isNotEmpty) 'reason': reason.trim(),
        }),
      );
    } catch (e) {
      throw const UserApiException(
        'Không thể kết nối đến máy chủ quản trị.',
        statusCode: 0,
      );
    }

    final dynamic body;
    try {
      body = jsonDecode(utf8.decode(response.bodyBytes));
    } catch (_) {
      throw UserApiException(
        'Phản hồi không hợp lệ (${response.statusCode})',
        statusCode: response.statusCode,
      );
    }

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return;
    }

    final msg = body is Map<String, dynamic> ? body['message']?.toString() : null;
    throw UserApiException(
      msg ?? 'Cập nhật trạng thái thất bại (${response.statusCode})',
      statusCode: response.statusCode,
    );
  }
}

import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../../core/network/api_constants.dart';
import '../models/user_model.dart';
import '../models/user_transaction_model.dart';

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

class AdminP2PTransferResult {
  final String transactionId;
  final String status;
  final num amount;
  final num fee;
  final String description;
  final String reason;
  final String authorizationReference;
  final String sourceUserId;
  final String sourceUserName;
  final num sourceBalanceBefore;
  final num sourceBalanceAfter;
  final String destinationUserId;
  final String destinationUserName;
  final String destinationPhoneMasked;
  final bool replayed;
  final String message;
  final DateTime createdAt;

  const AdminP2PTransferResult({
    required this.transactionId,
    required this.status,
    required this.amount,
    required this.fee,
    required this.description,
    required this.reason,
    required this.authorizationReference,
    required this.sourceUserId,
    required this.sourceUserName,
    required this.sourceBalanceBefore,
    required this.sourceBalanceAfter,
    required this.destinationUserId,
    required this.destinationUserName,
    required this.destinationPhoneMasked,
    this.replayed = false,
    this.message = 'Thực hiện chuyển tiền P2P thành công',
    required this.createdAt,
  });

  factory AdminP2PTransferResult.fromJson(
    Map<String, dynamic> data, {
    bool replayed = false,
    String? message,
  }) {
    return AdminP2PTransferResult(
      transactionId: data['transaction_id']?.toString() ?? '',
      status: data['status']?.toString() ?? 'SUCCESS',
      amount: num.tryParse(data['amount']?.toString() ?? '') ?? 0,
      fee: num.tryParse(data['fee']?.toString() ?? '') ?? 0,
      description: data['description']?.toString() ?? '',
      reason: data['reason']?.toString() ?? '',
      authorizationReference: data['authorization_reference']?.toString() ?? '',
      sourceUserId: data['source_user_id']?.toString() ?? '',
      sourceUserName: data['source_user_name']?.toString() ?? '',
      sourceBalanceBefore:
          num.tryParse(data['source_balance_before']?.toString() ?? '') ?? 0,
      sourceBalanceAfter:
          num.tryParse(data['source_balance_after']?.toString() ?? '') ?? 0,
      destinationUserId: data['destination_user_id']?.toString() ?? '',
      destinationUserName: data['destination_user_name']?.toString() ?? '',
      destinationPhoneMasked:
          data['destination_phone_masked']?.toString() ?? '',
      replayed: replayed,
      message: message ?? 'Thực hiện chuyển tiền P2P thành công',
      createdAt: DateTime.tryParse(data['created_at']?.toString() ?? '') ??
          DateTime.now(),
    );
  }
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

  /// Cập nhật thông tin định danh người dùng (họ tên, SĐT, email, bắt buộc có lý do)
  Future<UserModel> updateUserProfile({
    required String id,
    String? fullName,
    String? phone,
    String? email,
    required String reason,
  }) async {
    final uri = Uri.parse(ApiConstants.adminUserProfile(id));
    final bodyPayload = <String, dynamic>{
      'reason': reason.trim(),
    };
    if (fullName != null && fullName.trim().isNotEmpty) {
      bodyPayload['full_name'] = fullName.trim();
    }
    if (phone != null && phone.trim().isNotEmpty) {
      bodyPayload['phone'] = phone.trim();
    }
    if (email != null && email.trim().isNotEmpty) {
      bodyPayload['email'] = email.trim();
    }

    final http.Response response;
    try {
      response = await _client.patch(
        uri,
        headers: _headers,
        body: jsonEncode(bodyPayload),
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
      if (body is Map<String, dynamic> && body['data'] is Map<String, dynamic>) {
        return UserModel.fromJson(body['data'] as Map<String, dynamic>);
      }
      throw const UserApiException('Dữ liệu người dùng trả về không hợp lệ');
    }

    final msg = body is Map<String, dynamic> ? body['message']?.toString() : null;
    throw UserApiException(
      msg ?? 'Cập nhật thông tin người dùng thất bại (${response.statusCode})',
      statusCode: response.statusCode,
    );
  }

  /// Lấy danh sách lịch sử giao dịch của người dùng
  Future<UserTransactionPaginatedResult> getUserTransactions({
    required String userId,
    int page = 1,
    int limit = 10,
    String? period,
    String? startDate,
    String? endDate,
    String? keyword,
  }) async {
    final queryParams = <String, String>{
      'page': page.toString(),
      'limit': limit.toString(),
    };
    if (period != null && period.trim().isNotEmpty) {
      queryParams['period'] = period.trim();
    }
    if (startDate != null && startDate.trim().isNotEmpty) {
      queryParams['start_date'] = startDate.trim();
    }
    if (endDate != null && endDate.trim().isNotEmpty) {
      queryParams['end_date'] = endDate.trim();
    }
    if (keyword != null && keyword.trim().isNotEmpty) {
      queryParams['keyword'] = keyword.trim();
    }

    final uri = Uri.parse(ApiConstants.adminUserTransactions(userId))
        .replace(queryParameters: queryParams);
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
            .map((item) => UserTransactionModel.fromJson(item))
            .toList();

        return UserTransactionPaginatedResult(
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
      return UserTransactionPaginatedResult.empty();
    }

    final msg = body is Map<String, dynamic> ? body['message']?.toString() : null;
    throw UserApiException(
      msg ?? 'Lỗi tải lịch sử giao dịch (${response.statusCode})',
      statusCode: response.statusCode,
    );
  }

  /// Thực hiện chuyển tiền P2P thay mặt người dùng bởi Quản trị viên
  Future<AdminP2PTransferResult> executeAdminP2P({
    required String sourceUserId,
    required String destinationUserId,
    required int amount,
    required String reason,
    required String authorizationReference,
    String? description,
    required String adminPassword,
    required String idempotencyKey,
  }) async {
    final uri = Uri.parse(ApiConstants.adminUserP2PTransfer(sourceUserId));
    final requestHeaders = <String, String>{
      ..._headers,
      'Idempotency-Key': idempotencyKey.trim(),
    };
    final bodyPayload = <String, dynamic>{
      'destination_user_id': destinationUserId.trim(),
      'amount': amount,
      'reason': reason.trim(),
      'authorization_reference': authorizationReference.trim(),
      'admin_password': adminPassword,
      if (description != null && description.trim().isNotEmpty)
        'description': description.trim(),
    };

    final http.Response response;
    try {
      response = await _client.post(
        uri,
        headers: requestHeaders,
        body: jsonEncode(bodyPayload),
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
      if (body is Map<String, dynamic> && body['data'] is Map<String, dynamic>) {
        final replayed = body['replayed'] == true;
        final msg = body['message']?.toString();
        return AdminP2PTransferResult.fromJson(
          body['data'] as Map<String, dynamic>,
          replayed: replayed,
          message: msg,
        );
      }
      throw UserApiException(
        'Dữ liệu kết quả chuyển tiền không hợp lệ',
        statusCode: response.statusCode,
      );
    }

    final msg =
        body is Map<String, dynamic> ? body['message']?.toString() : null;
    throw UserApiException(
      msg ?? 'Thực hiện chuyển tiền P2P thất bại (${response.statusCode})',
      statusCode: response.statusCode,
    );
  }
}

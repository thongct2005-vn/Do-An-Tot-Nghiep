class ApiConstants {
  ApiConstants._();

  /// Base URL của Backend API (mặc định cổng 5000)
  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:5000/api/v2',
  );

  /// Endpoint đăng nhập và phiên Quản trị viên
  static const String adminLogin = '$baseUrl/admin/auth/login';
  static const String adminRefreshToken = '$baseUrl/admin/auth/refresh-token';
  static const String adminMe = '$baseUrl/admin/auth/me';
  static const String adminLogout = '$baseUrl/admin/auth/logout';

  /// Endpoint quản lý người dùng
  static const String adminUserStats = '$baseUrl/admin/user/stats';
  static const String adminUsers = '$baseUrl/admin/user';
  static String adminUserDetail(String id) => '$baseUrl/admin/user/$id';
  static String adminUserStatus(String id) => '$baseUrl/admin/user/$id/status';
  static String adminUserProfile(String id) => '$baseUrl/admin/user/$id/profile';
  static String adminUserTransactions(String id) =>
      '$baseUrl/admin/user/$id/transactions';
  static String adminUserP2PTransfer(String id) =>
      '$baseUrl/admin/user/$id/operations/p2p';
}


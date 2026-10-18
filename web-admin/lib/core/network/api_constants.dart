class ApiConstants {
  ApiConstants._();

  /// Base URL của Backend API (mặc định cổng 5000)
  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:5000/api/v2',
  );

  /// Endpoint đăng nhập Quản trị viên
  static const String adminLogin = '$baseUrl/admin/auth/login';

  /// Endpoint quản lý người dùng
  static const String adminUserStats = '$baseUrl/admin/user/stats';
  static const String adminUsers = '$baseUrl/admin/user';
  static String adminUserDetail(String id) => '$baseUrl/admin/user/$id';
  static String adminUserStatus(String id) => '$baseUrl/admin/user/$id/status';
}

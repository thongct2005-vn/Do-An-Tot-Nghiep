class AdminInfo {
  final String userId;
  final String email;
  final String? fullName;
  final String role;

  const AdminInfo({
    required this.userId,
    required this.email,
    this.fullName,
    required this.role,
  });

  factory AdminInfo.fromJson(Map<String, dynamic> json) {
    return AdminInfo(
      userId: json['user_id']?.toString() ?? '',
      email: json['email']?.toString() ?? '',
      fullName: json['full_name']?.toString(),
      role: json['role']?.toString() ?? 'ADMIN',
    );
  }

  Map<String, dynamic> toJson() => {
    'user_id': userId,
    'email': email,
    'full_name': fullName,
    'role': role,
  };
}

class AdminSessionModel {
  final String accessToken;
  final String refreshToken;
  final AdminInfo adminInfo;

  const AdminSessionModel({
    required this.accessToken,
    required this.refreshToken,
    required this.adminInfo,
  });

  factory AdminSessionModel.fromJson(Map<String, dynamic> json) {
    final token = json['token'] as Map<String, dynamic>? ?? {};
    final admin = json['admin_info'] as Map<String, dynamic>? ?? {};

    return AdminSessionModel(
      accessToken: token['access_token']?.toString() ?? '',
      refreshToken: token['refresh_token']?.toString() ?? '',
      adminInfo: AdminInfo.fromJson(admin),
    );
  }
}

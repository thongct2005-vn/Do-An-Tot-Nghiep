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

  AdminInfo copyWith({
    String? userId,
    String? email,
    String? fullName,
    String? role,
  }) {
    return AdminInfo(
      userId: userId ?? this.userId,
      email: email ?? this.email,
      fullName: fullName ?? this.fullName,
      role: role ?? this.role,
    );
  }
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
      accessToken: token['access_token']?.toString() ??
          json['access_token']?.toString() ??
          '',
      refreshToken: token['refresh_token']?.toString() ??
          json['refresh_token']?.toString() ??
          '',
      adminInfo: AdminInfo.fromJson(
        admin.isNotEmpty ? admin : json,
      ),
    );
  }

  Map<String, dynamic> toJson() => {
    'token': {
      'access_token': accessToken,
      'refresh_token': refreshToken,
    },
    'admin_info': adminInfo.toJson(),
  };

  AdminSessionModel copyWith({
    String? accessToken,
    String? refreshToken,
    AdminInfo? adminInfo,
  }) {
    return AdminSessionModel(
      accessToken: accessToken ?? this.accessToken,
      refreshToken: refreshToken ?? this.refreshToken,
      adminInfo: adminInfo ?? this.adminInfo,
    );
  }
}

enum KycStatus {
  verified('Đã xác thực'),
  pending('Chờ duyệt'),
  unverified('Chưa định danh');

  final String label;
  const KycStatus(this.label);
}

enum UserStatus {
  active('Đang hoạt động'),
  suspended('Đã khóa');

  final String label;
  const UserStatus(this.label);
}

class UserKycDetail {
  final String? cccdNumber;
  final String? dob;
  final String? gender;
  final String? address;
  final String? status;
  final DateTime? verifiedAt;

  const UserKycDetail({
    this.cccdNumber,
    this.dob,
    this.gender,
    this.address,
    this.status,
    this.verifiedAt,
  });

  factory UserKycDetail.fromJson(Map<String, dynamic> json) {
    return UserKycDetail(
      cccdNumber: json['cccd_number']?.toString(),
      dob: json['dob']?.toString(),
      gender: json['gender']?.toString(),
      address: json['address']?.toString(),
      status: json['status']?.toString(),
      verifiedAt: DateTime.tryParse(json['verified_at']?.toString() ?? ''),
    );
  }
}

class UserAuditLog {
  final DateTime timestamp;
  final String action;
  final String device;
  final String ipAddress;

  const UserAuditLog({
    required this.timestamp,
    required this.action,
    required this.device,
    required this.ipAddress,
  });

  factory UserAuditLog.fromJson(Map<String, dynamic> json) {
    return UserAuditLog(
      timestamp: DateTime.tryParse(json['timestamp']?.toString() ?? '') ?? DateTime.now(),
      action: json['action']?.toString() ?? '',
      device: json['device']?.toString() ?? 'Thiết bị di động',
      ipAddress: json['ip_address']?.toString() ?? '127.0.0.1',
    );
  }
}

class UserStats {
  final int totalUsers;
  final int activeUsers;
  final int suspendedUsers;

  const UserStats({
    required this.totalUsers,
    required this.activeUsers,
    required this.suspendedUsers,
  });

  factory UserStats.fromJson(Map<String, dynamic> json) {
    return UserStats(
      totalUsers: int.tryParse(json['total_users']?.toString() ?? '') ?? 0,
      activeUsers: int.tryParse(json['active_users']?.toString() ?? '') ?? 0,
      suspendedUsers: int.tryParse(json['suspended_users']?.toString() ?? '') ?? 0,
    );
  }
}

class UserModel {
  final String id;
  final String name;
  final String phone;
  final String email;
  final KycStatus kycStatus;
  UserStatus status;
  final num balance;
  final String bankName;
  final String bankAccount;
  final num dailyLimit;
  final num dailyUsed;
  final num monthlyLimit;
  final num monthlyUsed;
  final DateTime createdAt;
  final List<UserAuditLog> auditLogs;
  String? suspensionReason;
  final UserKycDetail? kycDetail;

  UserModel({
    required this.id,
    required this.name,
    required this.phone,
    required this.email,
    required this.kycStatus,
    required this.status,
    required this.balance,
    required this.bankName,
    required this.bankAccount,
    required this.dailyLimit,
    required this.dailyUsed,
    required this.monthlyLimit,
    required this.monthlyUsed,
    required this.createdAt,
    required this.auditLogs,
    this.suspensionReason,
    this.kycDetail,
  });

  factory UserModel.fromJson(Map<String, dynamic> json) {
    final kycRaw = (json['kyc_status'] ??
            (json['kyc'] is Map ? json['kyc']['status'] : null))
        ?.toString()
        .toUpperCase();
    final isVerified = kycRaw == 'APPROVED' || kycRaw == 'VERIFIED';
    final isPending = kycRaw == 'PENDING';
    final kyc = isVerified
        ? KycStatus.verified
        : (isPending ? KycStatus.pending : KycStatus.unverified);

    final statusRaw = json['status']?.toString().toUpperCase();
    final userStatus = (statusRaw == 'BLOCKED' || statusRaw == 'SUSPENDED')
        ? UserStatus.suspended
        : UserStatus.active;

    String bankName = json['bank_name']?.toString() ?? '';
    String bankAccount = json['bank_account']?.toString() ?? '';
    if (json['linked_banks'] is List && (json['linked_banks'] as List).isNotEmpty) {
      final firstBank = (json['linked_banks'] as List).first as Map<String, dynamic>;
      if (bankName.isEmpty) {
        bankName = firstBank['bank_name']?.toString() ?? '';
      }
      if (bankAccount.isEmpty) {
        bankAccount = firstBank['account_number']?.toString() ?? '';
      }
    }
    if (bankName.isEmpty) bankName = 'Chưa liên kết';

    final logs = <UserAuditLog>[];
    if (json['audit_logs'] is List) {
      for (final item in json['audit_logs'] as List) {
        if (item is Map<String, dynamic>) {
          logs.add(UserAuditLog.fromJson(item));
        }
      }
    }

    UserKycDetail? kycDetail;
    if (json['kyc'] is Map<String, dynamic>) {
      kycDetail = UserKycDetail.fromJson(json['kyc'] as Map<String, dynamic>);
    }

    return UserModel(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? json['full_name']?.toString() ?? 'Chưa cập nhật',
      phone: json['phone']?.toString() ?? '',
      email: json['email']?.toString() ?? '',
      kycStatus: kyc,
      status: userStatus,
      balance: num.tryParse(json['balance']?.toString() ?? '') ?? 0,
      bankName: bankName,
      bankAccount: bankAccount,
      dailyLimit: num.tryParse(json['daily_limit']?.toString() ?? '') ?? 50000000,
      dailyUsed: num.tryParse(json['daily_used']?.toString() ?? '') ?? 0,
      monthlyLimit: num.tryParse(json['monthly_limit']?.toString() ?? '') ?? 200000000,
      monthlyUsed: num.tryParse(json['monthly_used']?.toString() ?? '') ?? 0,
      createdAt: DateTime.tryParse(json['created_at']?.toString() ?? '') ?? DateTime.now(),
      auditLogs: logs,
      suspensionReason: json['suspension_reason']?.toString(),
      kycDetail: kycDetail,
    );
  }

  UserModel copyWith({
    String? name,
    String? phone,
    String? email,
    UserStatus? status,
    num? balance,
    num? dailyLimit,
    num? dailyUsed,
    String? suspensionReason,
    UserKycDetail? kycDetail,
  }) {
    return UserModel(
      id: id,
      name: name ?? this.name,
      phone: phone ?? this.phone,
      email: email ?? this.email,
      kycStatus: kycStatus,
      status: status ?? this.status,
      balance: balance ?? this.balance,
      bankName: bankName,
      bankAccount: bankAccount,
      dailyLimit: dailyLimit ?? this.dailyLimit,
      dailyUsed: dailyUsed ?? this.dailyUsed,
      monthlyLimit: monthlyLimit,
      monthlyUsed: monthlyUsed,
      createdAt: createdAt,
      auditLogs: auditLogs,
      suspensionReason: suspensionReason ?? this.suspensionReason,
      kycDetail: kycDetail ?? this.kycDetail,
    );
  }
}

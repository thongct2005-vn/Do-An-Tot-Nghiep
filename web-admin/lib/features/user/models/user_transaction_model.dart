class UserTransactionModel {
  final String id;
  final String type;
  final String direction; // 'IN' hoặc 'OUT'
  final num amount;
  final num fee;
  final num? balanceBefore;
  final num? balanceAfter;
  final String status;
  final String? description;
  final String? counterpartyName;
  final String? counterpartyPhone;
  final String paymentMethod;
  final String? bankName;
  final String? bankAccountNumber;
  final DateTime createdAt;
  final DateTime? updatedAt;

  const UserTransactionModel({
    required this.id,
    required this.type,
    required this.direction,
    required this.amount,
    this.fee = 0,
    this.balanceBefore,
    this.balanceAfter,
    required this.status,
    this.description,
    this.counterpartyName,
    this.counterpartyPhone,
    required this.paymentMethod,
    this.bankName,
    this.bankAccountNumber,
    required this.createdAt,
    this.updatedAt,
  });

  bool get isIncoming => direction.toUpperCase() == 'IN';

  String get typeLabel {
    switch (type.toUpperCase()) {
      case 'TRANSFER':
        return isIncoming ? 'Nhận tiền' : 'Chuyển tiền';
      case 'DEPOSIT':
        return 'Nạp tiền';
      case 'WITHDRAW':
        return 'Rút tiền';
      case 'PAYMENT':
        return 'Thanh toán';
      default:
        return type;
    }
  }

  String get statusLabel {
    switch (status.toUpperCase()) {
      case 'SUCCESS':
      case 'COMPLETED':
        return 'Thành công';
      case 'PENDING':
        return 'Đang xử lý';
      case 'FAILED':
        return 'Thất bại';
      case 'CANCELLED':
        return 'Đã hủy';
      default:
        return status;
    }
  }

  factory UserTransactionModel.fromJson(Map<String, dynamic> json) {
    return UserTransactionModel(
      id: json['id']?.toString() ?? '',
      type: json['type']?.toString().toUpperCase() ?? 'TRANSFER',
      direction: json['direction']?.toString().toUpperCase() ?? 'OUT',
      amount: num.tryParse(json['amount']?.toString() ?? '') ?? 0,
      fee: num.tryParse(json['fee']?.toString() ?? '') ?? 0,
      balanceBefore: num.tryParse(json['balance_before']?.toString() ?? ''),
      balanceAfter: num.tryParse(json['balance_after']?.toString() ?? ''),
      status: json['status']?.toString().toUpperCase() ?? 'COMPLETED',
      description: json['description']?.toString(),
      counterpartyName: json['counterparty_name']?.toString(),
      counterpartyPhone: json['counterparty_phone']?.toString(),
      paymentMethod: json['payment_method']?.toString().toUpperCase() ?? 'WALLET',
      bankName: json['bank_name']?.toString(),
      bankAccountNumber: json['bank_account_number']?.toString(),
      createdAt: DateTime.tryParse(json['created_at']?.toString() ?? '') ?? DateTime.now(),
      updatedAt: DateTime.tryParse(json['updated_at']?.toString() ?? ''),
    );
  }
}

class UserTransactionPaginatedResult {
  final List<UserTransactionModel> items;
  final int totalItems;
  final int totalPages;
  final int currentPage;
  final int limit;

  const UserTransactionPaginatedResult({
    required this.items,
    required this.totalItems,
    required this.totalPages,
    required this.currentPage,
    required this.limit,
  });

  factory UserTransactionPaginatedResult.empty() {
    return const UserTransactionPaginatedResult(
      items: [],
      totalItems: 0,
      totalPages: 1,
      currentPage: 1,
      limit: 10,
    );
  }
}

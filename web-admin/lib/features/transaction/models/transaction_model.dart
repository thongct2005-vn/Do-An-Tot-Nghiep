enum TransactionType {
  topup('Nạp tiền'),
  withdraw('Rút tiền'),
  payment('Thanh toán QR');

  final String label;
  const TransactionType(this.label);
}

enum TransactionStatus {
  success('Thành công'),
  pending('Đang xử lý'),
  failed('Thất bại');

  final String label;
  const TransactionStatus(this.label);
}

class TransactionTimelineStep {
  final String title;
  final String description;
  final DateTime timestamp;
  final bool isCompleted;

  const TransactionTimelineStep({
    required this.title,
    required this.description,
    required this.timestamp,
    this.isCompleted = true,
  });
}

class TransactionModel {
  final String id;
  final TransactionType type;
  final TransactionStatus status;
  final num amount;
  final num fee;
  final num vat;
  final String senderName;
  final String senderPhone;
  final String receiverName;
  final String receiverPhone;
  final String paymentMethod;
  final String description;
  final DateTime createdAt;
  final List<TransactionTimelineStep> timeline;

  const TransactionModel({
    required this.id,
    required this.type,
    required this.status,
    required this.amount,
    required this.fee,
    required this.vat,
    required this.senderName,
    required this.senderPhone,
    required this.receiverName,
    required this.receiverPhone,
    required this.paymentMethod,
    required this.description,
    required this.createdAt,
    required this.timeline,
  });

  num get totalDeduction => amount + fee + vat;
}

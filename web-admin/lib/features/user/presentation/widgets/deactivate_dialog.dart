import 'package:flutter/material.dart';
import '../../../../core/widgets/app_confirm_dialog.dart';
import '../../models/user_model.dart';

class DeactivateUserDialog {
  static Future<bool?> show(
    BuildContext context, {
    required UserModel user,
    required void Function(String reason) onDeactivate,
  }) {
    final isBlocked = user.status == UserStatus.suspended;
    return AppConfirmDialog.show(
      context,
      title: isBlocked
          ? 'Mở khóa tài khoản người dùng'
          : 'Vô hiệu hóa tài khoản người dùng',
      message: isBlocked
          ? 'Bạn có chắc chắn muốn mở khóa tài khoản của ${user.name} (${user.phone})? Người dùng sẽ được phép đăng nhập lại và tiếp tục thực hiện giao dịch ví.'
          : 'Bạn có chắc chắn muốn vô hiệu hóa tài khoản của ${user.name} (${user.phone})? Tài khoản này sẽ bị phong tỏa số dư khả dụng và bị ngắt quyền thực hiện mọi giao dịch nạp, rút, thanh toán trong hệ thống.',
      confirmLabel: isBlocked ? 'Mở khóa tài khoản' : 'Vô hiệu hóa tài khoản',
      isDestructive: !isBlocked,
      requireReason: !isBlocked,
      reasonHint: isBlocked
          ? 'Nhập lý do mở khóa (tùy chọn)...'
          : 'Nhập lý do phong tỏa / vô hiệu hóa tài khoản (bắt buộc)...',
      onConfirmWithReason: onDeactivate,
    );
  }
}

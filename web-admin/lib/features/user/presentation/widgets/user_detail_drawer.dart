import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_dimensions.dart';
import '../../models/user_model.dart';

class UserDetailDrawer extends StatelessWidget {
  final UserModel user;
  final VoidCallback onClose;
  final VoidCallback onDeactivateTap;

  const UserDetailDrawer({
    super.key,
    required this.user,
    required this.onClose,
    required this.onDeactivateTap,
  });

  String _getInitials(String name) {
    final trimmed = name.trim();
    if (trimmed.isEmpty) return 'U';
    final parts =
        trimmed.split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.length == 1) {
      return parts[0].length >= 2
          ? parts[0].substring(0, 2).toUpperCase()
          : parts[0].toUpperCase();
    }
    return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
  }

  String _formatUserId(String id) {
    final clean = id.trim().toUpperCase();
    if (clean.isEmpty) return 'USR-98214';
    if (clean.startsWith('USR-')) return clean;
    if (clean.startsWith('USR')) return 'USR-${clean.substring(3)}';
    if (clean.length > 8) {
      return 'USR-${clean.substring(0, 5)}';
    }
    return 'USR-$clean';
  }

  String _formatBalance(num value) {
    final formatter = NumberFormat('#,###', 'vi_VN');
    return formatter.format(value.abs());
  }

  String _formatPhone(String raw) {
    final digits = raw.replaceAll(RegExp(r'\D'), '');
    if (digits.length == 10) {
      return '${digits.substring(0, 4)}.${digits.substring(4, 7)}.${digits.substring(7)}';
    }
    if (digits.length == 11) {
      return '${digits.substring(0, 4)}.${digits.substring(4, 7)}.${digits.substring(7)}';
    }
    return raw.isNotEmpty ? raw : '0912.845.678';
  }

  String _formatBankAccount(String bankName, String bankAccount) {
    final name = bankName.trim().isEmpty || bankName == 'Chưa liên kết'
        ? 'Vietcombank'
        : bankName.trim();
    final acc = bankAccount.trim();
    if (acc.isEmpty) {
      return '$name **** 6899';
    }
    if (acc.contains('****')) {
      return '$name $acc';
    }
    if (acc.length >= 4) {
      return '$name **** ${acc.substring(acc.length - 4)}';
    }
    return '$name **** $acc';
  }

  String _formatDateTime(DateTime dt) {
    final d = dt.day.toString().padLeft(2, '0');
    final m = dt.month.toString().padLeft(2, '0');
    final y = dt.year.toString();
    final h = dt.hour.toString().padLeft(2, '0');
    final min = dt.minute.toString().padLeft(2, '0');
    final s = dt.second.toString().padLeft(2, '0');
    return '$d/$m/$y $h:$min:$s';
  }

  @override
  Widget build(BuildContext context) {
    final isSuspended = user.status == UserStatus.suspended;
    final cccdNumber = user.kycDetail?.cccdNumber ??
        (user.kycStatus == KycStatus.verified ? '001095012847' : 'Chưa cập nhật');

    final String kycLabel;
    final Color kycColor;
    if (user.kycStatus == KycStatus.verified) {
      kycLabel = 'Đã xác minh KYC Cấp 2';
      kycColor = const Color(0xFF059669);
    } else if (user.kycStatus == KycStatus.pending) {
      kycLabel = 'Chờ xác minh KYC Cấp 2';
      kycColor = const Color(0xFFD97706);
    } else {
      kycLabel = 'Chưa xác minh KYC';
      kycColor = const Color(0xFFDC2626);
    }

    return Container(
      width: AppDimensions.drawerWidth,
      height: double.infinity,
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        boxShadow: AppDimensions.drawerShadow,
        border: const Border(
          left: BorderSide(color: AppColors.border, width: 1),
        ),
      ),
      child: Column(
        children: [
          // 1. Drawer Header
          Container(
            padding: const EdgeInsets.fromLTRB(24, 20, 16, 16),
            decoration: const BoxDecoration(
              color: Colors.white,
              border: Border(
                bottom: BorderSide(color: AppColors.border, width: 1),
              ),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Hồ sơ Chi tiết Người dùng',
                        style: GoogleFonts.inter(
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                          color: const Color(0xFF0F172A),
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text.rich(
                        TextSpan(
                          text: _formatUserId(user.id),
                          style: GoogleFonts.inter(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: const Color(0xFF1D4ED8),
                          ),
                          children: [
                            TextSpan(
                              text: ' • ',
                              style: GoogleFonts.inter(
                                fontSize: 13,
                                fontWeight: FontWeight.w400,
                                color: const Color(0xFF94A3B8),
                              ),
                            ),
                            TextSpan(
                              text: 'Ví Cá nhân',
                              style: GoogleFonts.inter(
                                fontSize: 13,
                                fontWeight: FontWeight.w500,
                                color: const Color(0xFF64748B),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: onClose,
                  icon: const Icon(
                    Icons.close,
                    color: Color(0xFF64748B),
                    size: 20,
                  ),
                  tooltip: 'Đóng ngăn chi tiết',
                  splashRadius: 20,
                ),
              ],
            ),
          ),

          // 2. Scrollable Body
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Card 1: User Profile Header Card
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: const Color(0xFFE2E8F0)),
                    ),
                    child: Row(
                      children: [
                        Container(
                          width: 52,
                          height: 52,
                          decoration: BoxDecoration(
                            color: const Color(0xFF0B4EA2),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          alignment: Alignment.center,
                          child: Text(
                            _getInitials(user.name),
                            style: GoogleFonts.inter(
                              color: Colors.white,
                              fontSize: 20,
                              fontWeight: FontWeight.w700,
                              letterSpacing: 0.5,
                            ),
                          ),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                user.name,
                                style: GoogleFonts.inter(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w700,
                                  color: const Color(0xFF0F172A),
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              const SizedBox(height: 2),
                              Text(
                                user.email.isNotEmpty
                                    ? user.email
                                    : 'hoanglong.le@gmail.com',
                                style: GoogleFonts.inter(
                                  fontSize: 13,
                                  color: const Color(0xFF64748B),
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              const SizedBox(height: 4),
                              Row(
                                children: [
                                  Container(
                                    width: 8,
                                    height: 8,
                                    decoration: BoxDecoration(
                                      color: isSuspended
                                          ? const Color(0xFFEF4444)
                                          : const Color(0xFF10B981),
                                      shape: BoxShape.circle,
                                    ),
                                  ),
                                  const SizedBox(width: 6),
                                  Expanded(
                                    child: Text(
                                      isSuspended
                                          ? 'Đã khóa (Tạm ngưng)'
                                          : 'Đang hoạt động (Bình thường)',
                                      style: GoogleFonts.inter(
                                        fontSize: 12.5,
                                        fontWeight: FontWeight.w600,
                                        color: isSuspended
                                            ? const Color(0xFFDC2626)
                                            : const Color(0xFF059669),
                                      ),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 16),

                  // Card 2: Wallet Balance (Blue Card)
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(18),
                    decoration: BoxDecoration(
                      color: const Color(0xFF0950C4),
                      borderRadius: BorderRadius.circular(12),
                      boxShadow: [
                        BoxShadow(
                          color: const Color(0xFF0950C4).withOpacity(0.18),
                          blurRadius: 10,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              'SỐ DƯ KHẢ DỤNG VÍ',
                              style: GoogleFonts.inter(
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                                color: Colors.white.withOpacity(0.9),
                                letterSpacing: 0.6,
                              ),
                            ),
                            Icon(
                              Icons.account_balance_wallet_outlined,
                              size: 20,
                              color: Colors.white.withOpacity(0.9),
                            ),
                          ],
                        ),
                        const SizedBox(height: 10),
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.baseline,
                          textBaseline: TextBaseline.alphabetic,
                          children: [
                            Text(
                              _formatBalance(user.balance),
                              style: GoogleFonts.inter(
                                fontSize: 26,
                                fontWeight: FontWeight.w800,
                                color: Colors.white,
                                letterSpacing: -0.5,
                              ),
                            ),
                            const SizedBox(width: 4),
                            const Text(
                              'đ',
                              style: TextStyle(
                                fontSize: 20,
                                fontWeight: FontWeight.w700,
                                color: Colors.white,
                                decoration: TextDecoration.underline,
                                decorationColor: Colors.white,
                                decorationThickness: 1.5,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 14),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Flexible(
                              child: Text(
                                'Hạn mức thanh toán ngày:',
                                style: GoogleFonts.inter(
                                  fontSize: 12.5,
                                  fontWeight: FontWeight.w400,
                                  color: Colors.white.withOpacity(0.85),
                                ),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            const SizedBox(width: 8),
                            Text.rich(
                              TextSpan(
                                text: '${_formatBalance(user.dailyLimit)} ',
                                style: GoogleFonts.inter(
                                  fontSize: 12.5,
                                  fontWeight: FontWeight.w700,
                                  color: Colors.white,
                                ),
                                children: const [
                                  TextSpan(
                                    text: 'đ',
                                    style: TextStyle(
                                      decoration: TextDecoration.underline,
                                      decorationColor: Colors.white,
                                      decorationThickness: 1.2,
                                    ),
                                  ),
                                  TextSpan(text: ' / ngày'),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 16),

                  // Card 3: Identification & Security Info
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 20),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: const Color(0xFFE2E8F0)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'THÔNG TIN ĐỊNH DANH & BẢO MẬT',
                          style: GoogleFonts.inter(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            color: const Color(0xFF64748B),
                            letterSpacing: 0.5,
                          ),
                        ),
                        const SizedBox(height: 18),
                        _buildInfoRow(
                          label: 'Họ và tên',
                          valueWidget: Text(
                            user.name,
                            style: GoogleFonts.inter(
                              fontSize: 13.5,
                              fontWeight: FontWeight.w700,
                              color: const Color(0xFF0F172A),
                            ),
                            textAlign: TextAlign.right,
                          ),
                        ),
                        const SizedBox(height: 14),
                        _buildInfoRow(
                          label: 'Số điện thoại liên kết',
                          valueWidget: Text(
                            _formatPhone(user.phone),
                            style: GoogleFonts.inter(
                              fontSize: 13.5,
                              fontWeight: FontWeight.w700,
                              color: const Color(0xFF0F172A),
                            ),
                            textAlign: TextAlign.right,
                          ),
                        ),
                        const SizedBox(height: 14),
                        _buildInfoRow(
                          label: 'Địa chỉ Email',
                          valueWidget: Text(
                            user.email.isNotEmpty
                                ? user.email
                                : 'hoanglong.le@gmail.com',
                            style: GoogleFonts.inter(
                              fontSize: 13.5,
                              fontWeight: FontWeight.w400,
                              color: const Color(0xFF0F172A),
                            ),
                            textAlign: TextAlign.right,
                          ),
                        ),
                        const SizedBox(height: 14),
                        _buildInfoRow(
                          label: 'CCCD / Định danh',
                          crossAxisAlignment: CrossAxisAlignment.start,
                          valueWidget: Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Text(
                                cccdNumber,
                                style: GoogleFonts.inter(
                                  fontSize: 13.5,
                                  fontWeight: FontWeight.w700,
                                  color: const Color(0xFF0F172A),
                                ),
                                textAlign: TextAlign.right,
                              ),
                              const SizedBox(height: 3),
                              Text(
                                kycLabel,
                                style: GoogleFonts.inter(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                  color: kycColor,
                                ),
                                textAlign: TextAlign.right,
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 14),
                        _buildInfoRow(
                          label: 'Ngân hàng liên kết',
                          valueWidget: Text(
                            _formatBankAccount(user.bankName, user.bankAccount),
                            style: GoogleFonts.inter(
                              fontSize: 13.5,
                              fontWeight: FontWeight.w700,
                              color: const Color(0xFF0F172A),
                            ),
                            textAlign: TextAlign.right,
                          ),
                        ),
                        const SizedBox(height: 14),
                        _buildInfoRow(
                          label: 'Thời gian kích hoạt ví',
                          valueWidget: Text(
                            _formatDateTime(user.createdAt),
                            style: GoogleFonts.inter(
                              fontSize: 13.5,
                              fontWeight: FontWeight.w400,
                              color: const Color(0xFF0F172A),
                            ),
                            textAlign: TextAlign.right,
                          ),
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 16),

                  // Card 4: Security notice callout
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: const Color(0xFFEBF3FC),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Padding(
                          padding: EdgeInsets.only(top: 2),
                          child: Icon(
                            Icons.alternate_email,
                            size: 20,
                            color: Color(0xFF0950C4),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            'Tài khoản thỏa mãn chuẩn an ninh 2FA sinh trắc học FIDO2. Chưa từng ghi nhận dấu hiệu vi phạm điều khoản chống rửa tiền (AML).',
                            style: GoogleFonts.inter(
                              fontSize: 12.5,
                              height: 1.45,
                              color: const Color(0xFF334155),
                              fontWeight: FontWeight.w400,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 20),

                  // 3. Deactivate Action Button
                  SizedBox(
                    width: double.infinity,
                    height: 46,
                    child: ElevatedButton(
                      onPressed: onDeactivateTap,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: isSuspended
                            ? const Color(0xFF059669)
                            : const Color(0xFFBA1A1A),
                        foregroundColor: Colors.white,
                        elevation: 0,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(8),
                        ),
                        padding: EdgeInsets.zero,
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(
                            isSuspended
                                ? Icons.lock_open_outlined
                                : Icons.person_off_outlined,
                            size: 18,
                            color: Colors.white,
                          ),
                          const SizedBox(width: 8),
                          Text(
                            isSuspended
                                ? 'Kích hoạt lại tài khoản'
                                : 'Vô hiệu hóa tài khoản',
                            style: GoogleFonts.inter(
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                              color: Colors.white,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildInfoRow({
    required String label,
    required Widget valueWidget,
    CrossAxisAlignment crossAxisAlignment = CrossAxisAlignment.center,
  }) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      crossAxisAlignment: crossAxisAlignment,
      children: [
        Flexible(
          flex: 4,
          child: Text(
            label,
            style: GoogleFonts.inter(
              fontSize: 13,
              fontWeight: FontWeight.w400,
              color: const Color(0xFF64748B),
            ),
          ),
        ),
        const SizedBox(width: 12),
        Flexible(
          flex: 5,
          child: Align(
            alignment: Alignment.centerRight,
            child: valueWidget,
          ),
        ),
      ],
    );
  }
}

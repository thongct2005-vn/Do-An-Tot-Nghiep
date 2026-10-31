import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_dimensions.dart';
import '../../data/user_api_service.dart';
import '../../models/user_model.dart';
import '../../models/user_transaction_model.dart';
import 'admin_p2p_transfer_dialog.dart';

class UserDetailDrawer extends StatelessWidget {
  final UserModel user;
  final VoidCallback onClose;
  final VoidCallback onDeactivateTap;
  final VoidCallback? onEditTap;
  final UserApiService? apiService;
  final int transactionRefreshTick;
  final ValueChanged<AdminP2PTransferResult>? onP2PTransferSuccess;

  const UserDetailDrawer({
    super.key,
    required this.user,
    required this.onClose,
    required this.onDeactivateTap,
    this.onEditTap,
    this.apiService,
    this.transactionRefreshTick = 0,
    this.onP2PTransferSuccess,
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
    if (clean.isEmpty) return 'USR-00000';
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
    return raw.isNotEmpty ? raw : 'Chưa cập nhật';
  }

  String _formatBankAccount(String bankName, String bankAccount) {
    final name = bankName.trim();
    final acc = bankAccount.trim();
    if (name.isEmpty || name == 'Chưa liên kết' || acc.isEmpty) {
      return 'Chưa liên kết';
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
        (user.kycStatus == KycStatus.verified ? 'Đang cập nhật' : 'Chưa cập nhật');

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
                                    : 'Chưa cập nhật',
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
                          color: const Color(0xFF0950C4).withValues(alpha: 0.18),
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
                                color: Colors.white.withValues(alpha: 0.9),
                                letterSpacing: 0.6,
                              ),
                            ),
                            Icon(
                              Icons.account_balance_wallet_outlined,
                              size: 20,
                              color: Colors.white.withValues(alpha: 0.9),
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
                                  color: Colors.white.withValues(alpha: 0.85),
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
                        const SizedBox(height: 14),
                        Container(
                          width: double.infinity,
                          height: 1,
                          color: Colors.white.withValues(alpha: 0.2),
                        ),
                        const SizedBox(height: 12),
                        SizedBox(
                          width: double.infinity,
                          height: 38,
                          child: ElevatedButton.icon(
                            onPressed: isSuspended
                                ? null
                                : () async {
                                    final result =
                                        await AdminP2PTransferDialog.show(
                                      context,
                                      user: user,
                                      apiService: apiService,
                                    );
                                    if (result != null) {
                                      onP2PTransferSuccess?.call(result);
                                    }
                                  },
                            icon: Icon(
                              Icons.swap_horiz_rounded,
                              size: 18,
                              color: isSuspended
                                  ? Colors.white.withValues(alpha: 0.75)
                                  : const Color(0xFF0950C4),
                            ),
                            label: Text(
                              'Lệnh Chuyển tiền P2P',
                              style: GoogleFonts.inter(
                                fontSize: 13,
                                fontWeight: FontWeight.w700,
                                color: isSuspended
                                    ? Colors.white.withValues(alpha: 0.75)
                                    : const Color(0xFF0950C4),
                              ),
                            ),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: Colors.white,
                              foregroundColor: const Color(0xFF0950C4),
                              disabledBackgroundColor:
                                  Colors.white.withValues(alpha: 0.25),
                              disabledForegroundColor:
                                  Colors.white.withValues(alpha: 0.75),
                              elevation: 0,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(8),
                              ),
                              padding: EdgeInsets.zero,
                            ),
                          ),
                        ),
                        if (isSuspended) ...[
                          const SizedBox(height: 8),
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Icon(
                                Icons.lock_outline_rounded,
                                size: 14,
                                color: Colors.white.withValues(alpha: 0.9),
                              ),
                              const SizedBox(width: 6),
                              Expanded(
                                child: Text(
                                  'Tài khoản đang bị khóa. Không thể thực hiện chuyển tiền cho đến khi được kích hoạt lại.',
                                  style: GoogleFonts.inter(
                                    fontSize: 11.5,
                                    fontWeight: FontWeight.w500,
                                    color: Colors.white.withValues(alpha: 0.92),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ],
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
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Expanded(
                              child: Text(
                                'THÔNG TIN ĐỊNH DANH & BẢO MẬT',
                                style: GoogleFonts.inter(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w700,
                                  color: const Color(0xFF64748B),
                                  letterSpacing: 0.5,
                                ),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            if (onEditTap != null) ...[
                              const SizedBox(width: 8),
                              InkWell(
                                onTap: onEditTap,
                                borderRadius: BorderRadius.circular(6),
                                child: Padding(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      const Icon(
                                        Icons.edit_outlined,
                                        size: 14,
                                        color: AppColors.primary,
                                      ),
                                      const SizedBox(width: 4),
                                      Text(
                                        'Chỉnh sửa',
                                        style: GoogleFonts.inter(
                                          fontSize: 12,
                                          fontWeight: FontWeight.w600,
                                          color: AppColors.primary,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ],
                          ],
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
                                : 'Chưa cập nhật',
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
                        Builder(
                          builder: (context) {
                            final formattedBank = _formatBankAccount(user.bankName, user.bankAccount);
                            final isUnlinked = formattedBank == 'Chưa liên kết';
                            return _buildInfoRow(
                              label: 'Ngân hàng liên kết',
                              valueWidget: Text(
                                formattedBank,
                                style: GoogleFonts.inter(
                                  fontSize: 13.5,
                                  fontWeight: isUnlinked ? FontWeight.w500 : FontWeight.w700,
                                  color: isUnlinked ? const Color(0xFF64748B) : const Color(0xFF0F172A),
                                ),
                                textAlign: TextAlign.right,
                              ),
                            );
                          },
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
                      color: user.kycStatus == KycStatus.verified
                          ? const Color(0xFFEBF3FC)
                          : const Color(0xFFF1F5F9),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Icon(
                            user.kycStatus == KycStatus.verified
                                ? Icons.verified_user_outlined
                                : Icons.info_outline,
                            size: 20,
                            color: user.kycStatus == KycStatus.verified
                                ? const Color(0xFF0950C4)
                                : const Color(0xFF64748B),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            user.kycStatus == KycStatus.verified
                                ? 'Tài khoản đã hoàn tất xác thực danh tính (KYC Cấp 2). Thỏa mãn tiêu chuẩn an ninh và quy định của Ngân hàng Nhà nước.'
                                : user.kycStatus == KycStatus.pending
                                    ? 'Hồ sơ định danh đang trong quá trình chờ phê duyệt bởi quản trị viên.'
                                    : 'Tài khoản chưa hoàn tất xác thực danh tính (KYC). Một số tính năng và hạn mức giao dịch bị giới hạn theo quy định.',
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

                  const SizedBox(height: 16),

                  // Card 5: User Transactions Section
                  _UserTransactionsSection(
                    userId: user.id,
                    apiService: apiService,
                    refreshTick: transactionRefreshTick,
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

class _UserTransactionsSection extends StatefulWidget {
  final String userId;
  final UserApiService? apiService;
  final int refreshTick;

  const _UserTransactionsSection({
    required this.userId,
    this.apiService,
    this.refreshTick = 0,
  });

  @override
  State<_UserTransactionsSection> createState() =>
      _UserTransactionsSectionState();
}

class _UserTransactionsSectionState extends State<_UserTransactionsSection> {
  late final UserApiService _apiService;
  String? _selectedPeriod; // null = 'Tất cả', 'day', 'week', 'month'
  int _currentPage = 1;
  static const int _limit = 5;

  bool _isLoading = false;
  String? _errorMessage;
  UserTransactionPaginatedResult? _result;

  @override
  void initState() {
    super.initState();
    _apiService = widget.apiService ?? UserApiService();
    _fetchTransactions();
  }

  @override
  void didUpdateWidget(covariant _UserTransactionsSection oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.userId != widget.userId) {
      _currentPage = 1;
      _selectedPeriod = null;
      _fetchTransactions();
    } else if (oldWidget.refreshTick != widget.refreshTick) {
      _currentPage = 1;
      _fetchTransactions();
    }
  }

  Future<void> _fetchTransactions() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final res = await _apiService.getUserTransactions(
        userId: widget.userId,
        page: _currentPage,
        limit: _limit,
        period: _selectedPeriod,
      );
      if (mounted) {
        setState(() {
          _result = res;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = e.toString();
          _isLoading = false;
        });
      }
    }
  }

  void _onPeriodChanged(String? period) {
    if (_selectedPeriod == period) return;
    setState(() {
      _selectedPeriod = period;
      _currentPage = 1;
    });
    _fetchTransactions();
  }

  void _onPageChanged(int page) {
    if (page < 1 || (_result != null && page > _result!.totalPages)) return;
    setState(() {
      _currentPage = page;
    });
    _fetchTransactions();
  }

  String _formatAmount(num amount) {
    final formatter = NumberFormat('#,###', 'vi_VN');
    return formatter.format(amount.abs());
  }

  String _formatDate(DateTime dt) {
    final d = dt.day.toString().padLeft(2, '0');
    final m = dt.month.toString().padLeft(2, '0');
    final y = dt.year.toString();
    final h = dt.hour.toString().padLeft(2, '0');
    final min = dt.minute.toString().padLeft(2, '0');
    return '$d/$m/$y $h:$min';
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header + count
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'LỊCH SỬ GIAO DỊCH',
                style: GoogleFonts.inter(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: const Color(0xFF64748B),
                  letterSpacing: 0.5,
                ),
              ),
              if (_result != null)
                Text(
                  '${_result!.totalItems} giao dịch',
                  style: GoogleFonts.inter(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: const Color(0xFF0950C4),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 12),

          // Period Filter Chips
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _buildFilterChip('Tất cả', null),
                const SizedBox(width: 6),
                _buildFilterChip('Hôm nay', 'day'),
                const SizedBox(width: 6),
                _buildFilterChip('Tuần này', 'week'),
                const SizedBox(width: 6),
                _buildFilterChip('Tháng này', 'month'),
              ],
            ),
          ),
          const SizedBox(height: 14),

          // Content body
          if (_isLoading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 32),
              child: Center(
                child: SizedBox(
                  width: 28,
                  height: 28,
                  child: CircularProgressIndicator(strokeWidth: 2.5),
                ),
              ),
            )
          else if (_errorMessage != null)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 20),
              child: Column(
                children: [
                  Text(
                    _errorMessage!,
                    style: GoogleFonts.inter(
                      fontSize: 12.5,
                      color: AppColors.danger,
                    ),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 8),
                  TextButton.icon(
                    onPressed: _fetchTransactions,
                    icon: const Icon(Icons.refresh, size: 16),
                    label: Text(
                      'Thử lại',
                      style: GoogleFonts.inter(fontSize: 12.5),
                    ),
                  ),
                ],
              ),
            )
          else if (_result == null || _result!.items.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 24),
              child: Center(
                child: Column(
                  children: [
                    const Icon(
                      Icons.receipt_long_outlined,
                      size: 36,
                      color: Color(0xFF94A3B8),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Không có giao dịch nào trong khoảng thời gian này',
                      style: GoogleFonts.inter(
                        fontSize: 12.5,
                        color: const Color(0xFF64748B),
                      ),
                      textAlign: TextAlign.center,
                    ),
                  ],
                ),
              ),
            )
          else ...[
            ListView.separated(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: _result!.items.length,
              separatorBuilder: (context, index) => const Divider(
                height: 16,
                color: Color(0xFFF1F5F9),
              ),
              itemBuilder: (context, index) {
                final item = _result!.items[index];
                return _buildTransactionItem(item);
              },
            ),
            const SizedBox(height: 12),

            // Pagination Controls
            if (_result!.totalPages > 1) ...[
              const Divider(height: 1, color: Color(0xFFE2E8F0)),
              const SizedBox(height: 10),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Trang $_currentPage / ${_result!.totalPages}',
                    style: GoogleFonts.inter(
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                      color: const Color(0xFF64748B),
                    ),
                  ),
                  Row(
                    children: [
                      IconButton(
                        onPressed: _currentPage > 1
                            ? () => _onPageChanged(_currentPage - 1)
                            : null,
                        icon: const Icon(Icons.chevron_left),
                        iconSize: 20,
                        splashRadius: 18,
                        tooltip: 'Trang trước',
                        padding: EdgeInsets.zero,
                        constraints: const BoxConstraints(
                          minWidth: 32,
                          minHeight: 32,
                        ),
                      ),
                      const SizedBox(width: 4),
                      IconButton(
                        onPressed: _currentPage < _result!.totalPages
                            ? () => _onPageChanged(_currentPage + 1)
                            : null,
                        icon: const Icon(Icons.chevron_right),
                        iconSize: 20,
                        splashRadius: 18,
                        tooltip: 'Trang sau',
                        padding: EdgeInsets.zero,
                        constraints: const BoxConstraints(
                          minWidth: 32,
                          minHeight: 32,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ],
        ],
      ),
    );
  }

  Widget _buildFilterChip(String label, String? period) {
    final isSelected = _selectedPeriod == period;
    return InkWell(
      onTap: () => _onPeriodChanged(period),
      borderRadius: BorderRadius.circular(6),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color:
              isSelected ? const Color(0xFF0950C4) : const Color(0xFFF8FAFC),
          borderRadius: BorderRadius.circular(6),
          border: Border.all(
            color:
                isSelected ? const Color(0xFF0950C4) : const Color(0xFFE2E8F0),
            width: 1,
          ),
        ),
        child: Text(
          label,
          style: GoogleFonts.inter(
            fontSize: 11.5,
            fontWeight: isSelected ? FontWeight.w600 : FontWeight.w500,
            color: isSelected ? Colors.white : const Color(0xFF475569),
          ),
        ),
      ),
    );
  }

  Widget _buildTransactionItem(UserTransactionModel item) {
    final isIncoming = item.isIncoming;
    final amountSign = isIncoming ? '+' : '-';
    final amountColor =
        isIncoming ? const Color(0xFF059669) : const Color(0xFF0F172A);

    // Build subtitle description
    String subInfo = '';
    if (item.counterpartyName != null && item.counterpartyName!.isNotEmpty) {
      subInfo = item.counterpartyName!;
      if (item.counterpartyPhone != null &&
          item.counterpartyPhone!.isNotEmpty) {
        subInfo += ' • ${item.counterpartyPhone}';
      }
    } else if (item.bankName != null && item.bankName!.isNotEmpty) {
      subInfo = item.bankName!;
      if (item.bankAccountNumber != null &&
          item.bankAccountNumber!.isNotEmpty) {
        subInfo += ' (${item.bankAccountNumber})';
      }
    } else if (item.description != null && item.description!.isNotEmpty) {
      subInfo = item.description!;
    }

    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        // Direction Icon
        Container(
          width: 34,
          height: 34,
          decoration: BoxDecoration(
            color:
                isIncoming ? const Color(0xFFECFDF5) : const Color(0xFFFEF2F2),
            shape: BoxShape.circle,
          ),
          child: Icon(
            isIncoming
                ? Icons.arrow_downward_rounded
                : Icons.arrow_upward_rounded,
            size: 18,
            color:
                isIncoming ? const Color(0xFF059669) : const Color(0xFFDC2626),
          ),
        ),
        const SizedBox(width: 10),

        // Title + counterparty + date
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                item.typeLabel,
                style: GoogleFonts.inter(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: const Color(0xFF0F172A),
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              if (subInfo.isNotEmpty) ...[
                const SizedBox(height: 2),
                Text(
                  subInfo,
                  style: GoogleFonts.inter(
                    fontSize: 11.5,
                    color: const Color(0xFF64748B),
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
              const SizedBox(height: 2),
              Text(
                _formatDate(item.createdAt),
                style: GoogleFonts.inter(
                  fontSize: 11,
                  color: const Color(0xFF94A3B8),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 10),

        // Amount & Status
        Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              '$amountSign${_formatAmount(item.amount)} đ',
              style: GoogleFonts.inter(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: amountColor,
              ),
            ),
            const SizedBox(height: 3),
            _buildStatusBadge(item.status),
          ],
        ),
      ],
    );
  }

  Widget _buildStatusBadge(String status) {
    Color bg;
    Color text;
    String label;

    switch (status.toUpperCase()) {
      case 'SUCCESS':
      case 'COMPLETED':
        bg = const Color(0xFFECFDF5);
        text = const Color(0xFF059669);
        label = 'Thành công';
        break;
      case 'PENDING':
        bg = const Color(0xFFFFFBEB);
        text = const Color(0xFFD97706);
        label = 'Đang xử lý';
        break;
      case 'FAILED':
        bg = const Color(0xFFFEF2F2);
        text = const Color(0xFFDC2626);
        label = 'Thất bại';
        break;
      default:
        bg = const Color(0xFFF1F5F9);
        text = const Color(0xFF64748B);
        label = status;
        break;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        label,
        style: GoogleFonts.inter(
          fontSize: 10,
          fontWeight: FontWeight.w600,
          color: text,
        ),
      ),
    );
  }
}


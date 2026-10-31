import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_dimensions.dart';
import '../../data/user_api_service.dart';
import '../../models/user_model.dart';

/// Hộp thoại thực hiện Chuyển tiền P2P hai bước do Quản trị viên thao tác
class AdminP2PTransferDialog extends StatefulWidget {
  final UserModel user;
  final UserApiService? apiService;

  const AdminP2PTransferDialog({
    super.key,
    required this.user,
    this.apiService,
  });

  /// Phương thức tiện ích để mở Dialog và nhận kết quả giao dịch thành công
  static Future<AdminP2PTransferResult?> show(
    BuildContext context, {
    required UserModel user,
    UserApiService? apiService,
  }) {
    return showDialog<AdminP2PTransferResult>(
      context: context,
      barrierDismissible: false,
      barrierColor: const Color(0x7F0F172A),
      builder: (ctx) => AdminP2PTransferDialog(
        user: user,
        apiService: apiService,
      ),
    );
  }

  @override
  State<AdminP2PTransferDialog> createState() => _AdminP2PTransferDialogState();
}

class _AdminP2PTransferDialogState extends State<AdminP2PTransferDialog> {
  static const int _p2pFee = 0;
  static const int _minPerTransaction = 1000;
  static const int _maxPerTransaction = 50000000;

  static final RegExp _phoneRegex = RegExp(r'^0\d{9}$');
  static final RegExp _uuidRegex = RegExp(
    r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
  );
  static final RegExp _authRefRegex = RegExp(r'^[A-Za-z0-9_-]{5,100}$');

  late final UserApiService _apiService;
  late final TextEditingController _destPhoneController;
  late final TextEditingController _amountController;
  late final TextEditingController _authRefController;
  late final TextEditingController _customReasonController;
  late final TextEditingController _descController;
  late final TextEditingController _adminPasswordController;

  Timer? _lookupDebounce;
  bool _isLookingUpRecipient = false;
  UserModel? _verifiedRecipient;
  String? _recipientLookupError;

  int _currentStep = 1;
  String? _step1Error;
  String? _submitError;
  bool _isSubmitting = false;
  bool _obscurePassword = true;

  String? _idempotencyKey;
  bool _isNetworkRetryPending = false;

  static const String _otherReasonOption = 'Lý do nghiệp vụ khác...';
  String _selectedReason = 'Hỗ trợ xử lý khiếu nại khách hàng';
  final List<String> _reasonOptions = const [
    'Hỗ trợ xử lý khiếu nại khách hàng',
    'Khắc phục sai lệch đối soát kỹ thuật',
    'Hoàn tiền theo yêu cầu tra soát',
    _otherReasonOption,
  ];

  @override
  void initState() {
    super.initState();
    _apiService = widget.apiService ?? UserApiService();
    _destPhoneController = TextEditingController();
    _amountController = TextEditingController();
    _authRefController = TextEditingController();
    _customReasonController = TextEditingController();
    _descController = TextEditingController();
    _adminPasswordController = TextEditingController();
  }

  @override
  void dispose() {
    _lookupDebounce?.cancel();
    _destPhoneController.dispose();
    _amountController.dispose();
    _authRefController.dispose();
    _customReasonController.dispose();
    _descController.dispose();
    _adminPasswordController.dispose();
    super.dispose();
  }

  String _formatCurrency(num value) {
    final formatter = NumberFormat('#,###', 'vi_VN');
    return formatter.format(value.abs());
  }

  int get _remainingDailyLimit {
    final remaining = (widget.user.dailyLimit - widget.user.dailyUsed).floor();
    return math.max(0, remaining);
  }

  int get _maxTransferable {
    final balanceLimit = widget.user.balance.floor() - _p2pFee;
    final dailyLimitRemaining = _remainingDailyLimit - _p2pFee;
    final lowest = math.min(
      balanceLimit,
      math.min(dailyLimitRemaining, _maxPerTransaction),
    );
    return math.max(0, lowest);
  }

  int? get _parsedAmount {
    final raw =
        _amountController.text.replaceAll(RegExp(r'[.,\s]'), '').trim();
    if (raw.isEmpty) return null;
    return int.tryParse(raw);
  }

  String get _effectiveReason {
    if (_selectedReason == _otherReasonOption) {
      return _customReasonController.text.trim();
    }
    return _selectedReason.trim();
  }

  String get _effectiveDescription {
    final custom = _descController.text.trim();
    if (custom.isNotEmpty) {
      return custom.length > 255 ? custom.substring(0, 255) : custom;
    }
    return 'Admin hỗ trợ chuyển tiền (${_authRefController.text.trim()})';
  }

  bool get _isRecipientValid {
    return _verifiedRecipient != null &&
        _verifiedRecipient!.id != widget.user.id &&
        _verifiedRecipient!.status == UserStatus.active &&
        _recipientLookupError == null;
  }

  String _generateUuidV4() {
    final rng = math.Random.secure();
    final bytes = List<int>.generate(16, (_) => rng.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    String hex(int b) => b.toRadixString(16).padLeft(2, '0');
    return '${hex(bytes[0])}${hex(bytes[1])}${hex(bytes[2])}${hex(bytes[3])}-'
        '${hex(bytes[4])}${hex(bytes[5])}-'
        '${hex(bytes[6])}${hex(bytes[7])}-'
        '${hex(bytes[8])}${hex(bytes[9])}-'
        '${hex(bytes[10])}${hex(bytes[11])}${hex(bytes[12])}${hex(bytes[13])}${hex(bytes[14])}${hex(bytes[15])}';
  }

  void _invalidateTransactionKey() {
    _idempotencyKey = null;
    _isNetworkRetryPending = false;
    _step1Error = null;
    _submitError = null;
  }

  void _onRecipientInputChanged(String value) {
    _lookupDebounce?.cancel();
    final clean = value.trim();
    setState(() {
      _verifiedRecipient = null;
      _recipientLookupError = null;
      _invalidateTransactionKey();
    });

    if (clean.isEmpty) return;

    if (_phoneRegex.hasMatch(clean) || _uuidRegex.hasMatch(clean)) {
      _lookupDebounce = Timer(
        const Duration(milliseconds: 350),
        () => _performRecipientLookup(clean),
      );
    }
  }

  Future<void> _performRecipientLookup([String? rawInput]) async {
    _lookupDebounce?.cancel();
    final clean = (rawInput ?? _destPhoneController.text).trim();

    if (clean.isEmpty) {
      setState(() {
        _verifiedRecipient = null;
        _recipientLookupError =
            'Vui lòng nhập số điện thoại (10 chữ số) hoặc UUID người nhận.';
      });
      return;
    }

    if (!_phoneRegex.hasMatch(clean) && !_uuidRegex.hasMatch(clean)) {
      setState(() {
        _verifiedRecipient = null;
        _recipientLookupError =
            'Định dạng không hợp lệ. Vui lòng nhập đúng 10 chữ số điện thoại hoặc mã UUID.';
      });
      return;
    }

    setState(() {
      _isLookingUpRecipient = true;
      _verifiedRecipient = null;
      _recipientLookupError = null;
    });

    try {
      final result = await _apiService.getUsers(search: clean, limit: 5);
      if (!mounted) return;

      // Đối soát khớp chính xác tuyệt đối theo phone hoặc UUID, không tự động lấy phần tử đầu tiên
      final exactMatches = result.items.where((u) {
        return u.phone.trim() == clean ||
            u.id.trim().toLowerCase() == clean.toLowerCase();
      }).toList();

      setState(() {
        _isLookingUpRecipient = false;
        if (exactMatches.length != 1) {
          _verifiedRecipient = null;
          _recipientLookupError =
              'Không tìm thấy tài khoản người nhận khớp chính xác với "$clean".';
        } else {
          final matched = exactMatches.first;
          _verifiedRecipient = matched;
          if (matched.id == widget.user.id) {
            _recipientLookupError =
                'Không thể chuyển tiền cho chính mình (ví nguồn và ví đích trùng nhau).';
          } else if (matched.status == UserStatus.suspended) {
            _recipientLookupError =
                'Tài khoản người nhận (${matched.name}) đang bị khóa (BLOCKED), không thể nhận tiền.';
          } else {
            _recipientLookupError = null;
          }
        }
      });
    } on UserApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _isLookingUpRecipient = false;
        _verifiedRecipient = null;
        _recipientLookupError = e.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _isLookingUpRecipient = false;
        _verifiedRecipient = null;
        _recipientLookupError =
            'Lỗi tra cứu người nhận. Vui lòng kiểm tra kết nối và thử lại.';
      });
    }
  }

  void _setAmount(int amount) {
    setState(() {
      _amountController.text = amount.toString();
      _invalidateTransactionKey();
    });
  }

  void _handleClose() {
    if (_isSubmitting) return;
    Navigator.of(context).pop();
  }

  void _handleProceedToStep2() {
    if (_isLookingUpRecipient) {
      setState(() {
        _step1Error = 'Đang đối soát người nhận, vui lòng đợi trong giây lát.';
      });
      return;
    }

    if (!_isRecipientValid) {
      setState(() {
        _step1Error = _recipientLookupError ??
            'Vui lòng tra cứu và xác minh chính xác tài khoản người nhận hợp lệ (ACTIVE).';
      });
      return;
    }

    final amount = _parsedAmount;
    if (amount == null) {
      setState(() {
        _step1Error = 'Vui lòng nhập số tiền chuyển là số nguyên hợp lệ.';
      });
      return;
    }

    if (amount < _minPerTransaction) {
      setState(() {
        _step1Error =
            'Số tiền chuyển tối thiểu là ${_formatCurrency(_minPerTransaction)} đ.';
      });
      return;
    }

    if (amount > _maxPerTransaction) {
      setState(() {
        _step1Error =
            'Số tiền chuyển vượt mức tối đa ${_formatCurrency(_maxPerTransaction)} đ/giao dịch.';
      });
      return;
    }

    if (amount + _p2pFee > widget.user.balance.floor()) {
      setState(() {
        _step1Error =
            'Số tiền chuyển vượt quá số dư khả dụng của ví nguồn (${_formatCurrency(widget.user.balance)} đ).';
      });
      return;
    }

    if (amount + _p2pFee > _remainingDailyLimit) {
      setState(() {
        _step1Error =
            'Số tiền chuyển vượt quá hạn mức giao dịch còn lại trong ngày (${_formatCurrency(_remainingDailyLimit)} đ).';
      });
      return;
    }

    final reason = _effectiveReason;
    if (reason.isEmpty) {
      setState(() {
        _step1Error = 'Vui lòng nhập lý do thực hiện giao dịch.';
      });
      return;
    }
    if (reason.length > 500) {
      setState(() {
        _step1Error = 'Lý do thực hiện giao dịch tối đa 500 ký tự.';
      });
      return;
    }

    final authRef = _authRefController.text.trim();
    if (!_authRefRegex.hasMatch(authRef)) {
      setState(() {
        _step1Error =
            'Mã văn bản / Ticket (authorization_reference) bắt buộc từ 5-100 ký tự (chữ, số, gạch ngang, gạch dưới).';
      });
      return;
    }

    setState(() {
      _step1Error = null;
      _submitError = null;
      _currentStep = 2;
    });
  }

  void _handleBackToStep1() {
    if (_isSubmitting) return;
    setState(() {
      _currentStep = 1;
      _submitError = null;
    });
  }

  Future<void> _handleSubmitTransfer() async {
    if (_isSubmitting) return;

    final adminPassword = _adminPasswordController.text;
    if (adminPassword.isEmpty) {
      setState(() {
        _submitError =
            'Vui lòng nhập mật khẩu Quản trị viên để xác nhận thực hiện lệnh chuyển.';
      });
      return;
    }

    final recipient = _verifiedRecipient;
    final amount = _parsedAmount;
    if (recipient == null || amount == null) {
      setState(() {
        _currentStep = 1;
        _step1Error = 'Thông tin giao dịch chưa đầy đủ, vui lòng kiểm tra lại.';
      });
      return;
    }

    // Sinh UUID v4 mới nếu đây là lệnh mới hoặc sau khi đã sửa dữ liệu / lỗi nghiệp vụ
    _idempotencyKey ??= _generateUuidV4();
    final activeKey = _idempotencyKey!;

    setState(() {
      _isSubmitting = true;
      _submitError = null;
    });

    try {
      final result = await _apiService.executeAdminP2P(
        sourceUserId: widget.user.id,
        destinationUserId: recipient.id,
        amount: amount,
        reason: _effectiveReason,
        authorizationReference: _authRefController.text.trim(),
        description: _effectiveDescription,
        adminPassword: adminPassword,
        idempotencyKey: activeKey,
      );

      if (!mounted) return;
      Navigator.of(context).pop(result);
    } on UserApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _isSubmitting = false;
        if (e.statusCode == 0) {
          // Lỗi mạng / timeout chưa rõ kết quả -> Giữ nguyên _idempotencyKey để gửi lại an toàn
          _isNetworkRetryPending = true;
          _submitError =
              '${e.message} Hệ thống đang giữ nguyên mã chống trùng lặp (Idempotency-Key) để bạn có thể bấm gửi lại an toàn mà không lo trừ tiền hai lần.';
        } else if (e.statusCode == 400 ||
            e.statusCode == 401 ||
            e.statusCode == 403 ||
            e.statusCode == 404 ||
            e.statusCode == 422) {
          // Lỗi nghiệp vụ xác định -> Cho phép sinh Idempotency-Key mới ở lần gửi kế tiếp
          _idempotencyKey = null;
          _isNetworkRetryPending = false;
          _submitError = e.message;
        } else {
          _submitError = e.message;
        }
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _isSubmitting = false;
        _isNetworkRetryPending = true;
        _submitError =
            'Đã xảy ra lỗi kết nối không xác định. Bạn có thể bấm gửi lại với cùng mã Idempotency-Key.';
      });
    }
  }

  String _getInitials(String fullName) {
    final parts =
        fullName.trim().split(RegExp(r'\s+')).where((s) => s.isNotEmpty).toList();
    if (parts.isEmpty) return 'U';
    if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
    return '${parts.first.substring(0, 1)}${parts.last.substring(0, 1)}'
        .toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: Colors.transparent,
      elevation: 0,
      insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
      child: Container(
        width: 620,
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: AppDimensions.borderRadiusMd,
          boxShadow: AppDimensions.dialogShadow,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _buildHeader(),
            const Divider(height: 1, color: AppColors.border),
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(24),
                child: _currentStep == 1
                    ? _buildStep1Form()
                    : _buildStep2Confirmation(),
              ),
            ),
            const Divider(height: 1, color: AppColors.border),
            _buildFooter(),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 20, 16, 16),
      child: Row(
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: AppColors.primaryContainer,
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Icon(
              Icons.swap_horiz_rounded,
              color: AppColors.primary,
              size: 24,
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _currentStep == 1
                      ? 'Khởi Tạo Lệnh Chuyển Tiền P2P (Bước 1/2)'
                      : 'Xác Nhận Lệnh Chuyển Tiền P2P (Bước 2/2)',
                  style: GoogleFonts.inter(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  _currentStep == 1
                      ? 'Nhập thông tin giao dịch và đối soát chính xác người thụ hưởng'
                      : 'Kiểm tra bảng đối chiếu thông tin cuối cùng trước khi ký duyệt',
                  style: GoogleFonts.inter(
                    fontSize: 12,
                    color: AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: const Color(0xFFFEF3C7),
              borderRadius: BorderRadius.circular(6),
              border: Border.all(color: const Color(0xFFFDE68A)),
            ),
            child: Text(
              'Can thiệp Quản trị',
              style: GoogleFonts.inter(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: const Color(0xFF92400E),
              ),
            ),
          ),
          const SizedBox(width: 8),
          IconButton(
            onPressed: _isSubmitting ? null : _handleClose,
            icon: const Icon(Icons.close, size: 20),
            color: AppColors.textMuted,
            splashRadius: 20,
          ),
        ],
      ),
    );
  }

  Widget _buildSourceWalletCard() {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFEBF3FC),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: const Color(0xFFBFDBFE)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'VÍ NGUỒN (TRỪ TIỀN)',
                  style: GoogleFonts.inter(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: AppColors.primary,
                    letterSpacing: 0.5,
                  ),
                ),
                const SizedBox(height: 3),
                Text.rich(
                  TextSpan(
                    text: widget.user.name,
                    style: GoogleFonts.inter(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary,
                    ),
                    children: [
                      TextSpan(
                        text: ' (${widget.user.phone})',
                        style: GoogleFonts.inter(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w400,
                          color: AppColors.textSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
                Text(
                  'ID: ${widget.user.id}',
                  style: GoogleFonts.inter(
                    fontSize: 11.5,
                    color: AppColors.textMuted,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                'Số dư khả dụng:',
                style: GoogleFonts.inter(
                  fontSize: 11.5,
                  color: AppColors.textSecondary,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                '${_formatCurrency(widget.user.balance)} đ',
                style: GoogleFonts.inter(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                  color: AppColors.primary,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                'Hạn mức ngày còn lại: ${_formatCurrency(_remainingDailyLimit)} đ',
                style: GoogleFonts.inter(
                  fontSize: 11,
                  fontWeight: FontWeight.w500,
                  color: AppColors.textSecondary,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildStep1Form() {
    final currentAmount = _parsedAmount;
    final maxAmount = _maxTransferable;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildSourceWalletCard(),
        const SizedBox(height: 20),

        // Khối 2: Ví thụ hưởng (Người nhận)
        _buildLabel('Số điện thoại hoặc UUID người nhận', isRequired: true),
        const SizedBox(height: 6),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: TextFormField(
                controller: _destPhoneController,
                onChanged: _onRecipientInputChanged,
                onFieldSubmitted: (_) => _performRecipientLookup(),
                decoration: _inputDecoration(
                  hintText: 'Nhập 10 chữ số điện thoại hoặc UUID người nhận...',
                  prefixIcon: Icons.person_search_outlined,
                ),
              ),
            ),
            const SizedBox(width: 10),
            SizedBox(
              height: 42,
              child: OutlinedButton.icon(
                onPressed: _isLookingUpRecipient
                    ? null
                    : () => _performRecipientLookup(),
                icon: _isLookingUpRecipient
                    ? const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.manage_search_rounded, size: 18),
                label: Text(
                  'Tra cứu',
                  style: GoogleFonts.inter(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.primary,
                  side: const BorderSide(color: AppColors.primary),
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                  shape: RoundedRectangleBorder(
                    borderRadius: AppDimensions.borderRadiusMd,
                  ),
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        _buildRecipientVerificationStatus(),

        const SizedBox(height: 20),

        // Khối 3: Số tiền giao dịch + Quick Chips
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Flexible(
              child: _buildLabel('Số tiền chuyển giao dịch', isRequired: true),
            ),
            const SizedBox(width: 8),
            Flexible(
              child: Text(
                'Tối đa: ${_formatCurrency(maxAmount)} đ (Phí: 0 đ)',
                style: GoogleFonts.inter(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w600,
                  color: AppColors.primary,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
        const SizedBox(height: 6),
        TextFormField(
          controller: _amountController,
          keyboardType: TextInputType.number,
          onChanged: (_) {
            setState(() {
              _invalidateTransactionKey();
            });
          },
          style: GoogleFonts.inter(
            fontSize: 16,
            fontWeight: FontWeight.w700,
            color: AppColors.textPrimary,
          ),
          decoration: _inputDecoration(
            hintText: 'Nhập số tiền nguyên từ 1.000 đến 50.000.000...',
            prefixIcon: Icons.payments_outlined,
            suffixText: 'VND',
          ),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            _buildQuickAmountChip(
              '100,000 đ',
              100000,
              isSelected: currentAmount == 100000,
            ),
            _buildQuickAmountChip(
              '200,000 đ',
              200000,
              isSelected: currentAmount == 200000,
            ),
            _buildQuickAmountChip(
              '500,000 đ',
              500000,
              isSelected: currentAmount == 500000,
            ),
            _buildQuickAmountChip(
              '1,000,000 đ',
              1000000,
              isSelected: currentAmount == 1000000,
            ),
            _buildQuickAmountChip(
              '5,000,000 đ',
              5000000,
              isSelected: currentAmount == 5000000,
            ),
            _buildQuickAmountChip(
              'Tối đa khả dụng',
              maxAmount,
              isSelected: maxAmount > 0 && currentAmount == maxAmount,
            ),
          ],
        ),

        const SizedBox(height: 20),

        // Khối 4: Lý do can thiệp & Mã văn bản phê duyệt
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              flex: 3,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildLabel('Lý do can thiệp nghiệp vụ', isRequired: true),
                  const SizedBox(height: 6),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppColors.surfaceMuted,
                      borderRadius: AppDimensions.borderRadiusMd,
                      border: Border.all(color: AppColors.border),
                    ),
                    child: DropdownButtonHideUnderline(
                      child: DropdownButton<String>(
                        value: _selectedReason,
                        isExpanded: true,
                        icon: const Icon(
                          Icons.keyboard_arrow_down_rounded,
                          size: 20,
                        ),
                        style: GoogleFonts.inter(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w500,
                          color: AppColors.textPrimary,
                        ),
                        items: _reasonOptions.map((opt) {
                          return DropdownMenuItem<String>(
                            value: opt,
                            child: Text(
                              opt,
                              overflow: TextOverflow.ellipsis,
                            ),
                          );
                        }).toList(),
                        onChanged: (val) {
                          if (val != null) {
                            setState(() {
                              _selectedReason = val;
                              _invalidateTransactionKey();
                            });
                          }
                        },
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              flex: 2,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildLabel('Mã văn bản / Ticket', isRequired: true),
                  const SizedBox(height: 6),
                  TextFormField(
                    controller: _authRefController,
                    onChanged: (_) {
                      setState(() {
                        _invalidateTransactionKey();
                      });
                    },
                    style: GoogleFonts.inter(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w600,
                    ),
                    decoration: _inputDecoration(
                      hintText: 'VD: TICKET-2026-001',
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),

        if (_selectedReason == _otherReasonOption) ...[
          const SizedBox(height: 14),
          _buildLabel('Nhập lý do nghiệp vụ cụ thể', isRequired: true),
          const SizedBox(height: 6),
          TextFormField(
            controller: _customReasonController,
            onChanged: (_) {
              setState(() {
                _invalidateTransactionKey();
              });
            },
            style: GoogleFonts.inter(fontSize: 12.5),
            decoration: _inputDecoration(
              hintText: 'Nhập chi tiết lý do can thiệp (tối đa 500 ký tự)...',
            ),
          ),
        ],

        const SizedBox(height: 18),

        // Khối 5: Nội dung giao dịch
        _buildLabel('Nội dung chuyển tiền'),
        const SizedBox(height: 6),
        TextFormField(
          controller: _descController,
          onChanged: (_) {
            setState(() {
              _invalidateTransactionKey();
            });
          },
          style: GoogleFonts.inter(fontSize: 12.5),
          decoration: _inputDecoration(
            hintText:
                'Để trống sẽ mặc định: Admin hỗ trợ chuyển tiền (<Mã Ticket>)',
          ),
        ),

        if (_step1Error != null) ...[
          const SizedBox(height: 16),
          _buildErrorBanner(_step1Error!),
        ],
      ],
    );
  }

  Widget _buildRecipientVerificationStatus() {
    if (_isLookingUpRecipient) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: const Color(0xFFF8FAFC),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: const Color(0xFFE2E8F0)),
        ),
        child: Row(
          children: [
            const SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
            const SizedBox(width: 10),
            Text(
              'Đang đối soát chính xác tài khoản người nhận...',
              style: GoogleFonts.inter(
                fontSize: 12,
                color: AppColors.textSecondary,
              ),
            ),
          ],
        ),
      );
    }

    if (_recipientLookupError != null) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: const Color(0xFFFEF2F2),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: const Color(0xFFFECACA)),
        ),
        child: Row(
          children: [
            const Icon(
              Icons.error_outline_rounded,
              size: 18,
              color: Color(0xFFDC2626),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                _recipientLookupError!,
                style: GoogleFonts.inter(
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                  color: const Color(0xFFB91C1C),
                ),
              ),
            ),
          ],
        ),
      );
    }

    if (_isRecipientValid && _verifiedRecipient != null) {
      final recipient = _verifiedRecipient!;
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: const Color(0xFFECFDF5),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: const Color(0xFFA7F3D0)),
        ),
        child: Row(
          children: [
            Container(
              width: 30,
              height: 30,
              decoration: const BoxDecoration(
                color: Color(0xFF059669),
                shape: BoxShape.circle,
              ),
              alignment: Alignment.center,
              child: Text(
                _getInitials(recipient.name),
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        'Người nhận đã xác minh',
                        style: GoogleFonts.inter(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: const Color(0xFF047857),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 6, vertical: 1.5),
                        decoration: BoxDecoration(
                          color: const Color(0xFFD1FAE5),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          'ACTIVE',
                          style: GoogleFonts.inter(
                            fontSize: 10,
                            fontWeight: FontWeight.w700,
                            color: const Color(0xFF065F46),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text.rich(
                    TextSpan(
                      text: recipient.name,
                      style: GoogleFonts.inter(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary,
                      ),
                      children: [
                        TextSpan(
                          text: ' • ${recipient.phone}',
                          style: GoogleFonts.inter(
                            fontSize: 12.5,
                            fontWeight: FontWeight.w500,
                            color: const Color(0xFF059669),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const Icon(
              Icons.verified_rounded,
              size: 18,
              color: Color(0xFF059669),
            ),
          ],
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Row(
        children: [
          const Icon(
            Icons.info_outline_rounded,
            size: 16,
            color: AppColors.textMuted,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'Nhập đủ 10 chữ số điện thoại hoặc UUID hợp lệ để tự động đối soát chính xác người nhận.',
              style: GoogleFonts.inter(
                fontSize: 11.5,
                color: AppColors.textSecondary,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStep2Confirmation() {
    final recipient = _verifiedRecipient!;
    final amount = _parsedAmount ?? 0;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Bảng đối chiếu xác nhận giao dịch cuối cùng
        Container(
          decoration: BoxDecoration(
            color: const Color(0xFFF8FAFC),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: AppColors.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                decoration: const BoxDecoration(
                  color: Color(0xFFEBF3FC),
                  borderRadius: BorderRadius.vertical(top: Radius.circular(9)),
                ),
                child: Row(
                  children: [
                    const Icon(
                      Icons.fact_check_outlined,
                      size: 18,
                      color: AppColors.primary,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'BẢNG ĐỐI CHIẾU THÔNG TIN GIAO DỊCH CUỐI CÙNG',
                        style: GoogleFonts.inter(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: AppColors.primary,
                          letterSpacing: 0.4,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    _buildSummaryRow(
                      'Người gửi',
                      '${widget.user.name} (${widget.user.phone})',
                    ),
                    const Divider(height: 16, color: Color(0xFFE2E8F0)),
                    _buildSummaryRow(
                      'Người nhận',
                      '${recipient.name} (${recipient.phone})',
                      valueColor: const Color(0xFF059669),
                    ),
                    const Divider(height: 16, color: Color(0xFFE2E8F0)),
                    _buildSummaryRow(
                      'Số tiền',
                      '${_formatCurrency(amount)} đ',
                      valueColor: AppColors.primary,
                      isBoldValue: true,
                    ),
                    const Divider(height: 16, color: Color(0xFFE2E8F0)),
                    _buildSummaryRow(
                      'Phí giao dịch',
                      '${_formatCurrency(_p2pFee)} đ (Miễn phí P2P)',
                    ),
                    const Divider(height: 16, color: Color(0xFFE2E8F0)),
                    _buildSummaryRow(
                      'Lý do thực hiện',
                      _effectiveReason,
                    ),
                    const Divider(height: 16, color: Color(0xFFE2E8F0)),
                    _buildSummaryRow(
                      'Mã ủy quyền',
                      _authRefController.text.trim(),
                      isBoldValue: true,
                    ),
                    const Divider(height: 16, color: Color(0xFFE2E8F0)),
                    _buildSummaryRow(
                      'Nội dung sao kê',
                      _effectiveDescription,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),

        const SizedBox(height: 14),

        // Ghi chú giả định nghiệp vụ của đồ án
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: const Color(0xFFFFFBEB),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: const Color(0xFFFDE68A)),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(
                Icons.policy_outlined,
                size: 16,
                color: Color(0xFFB45309),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Ghi chú nghiệp vụ: Mã ủy quyền (authorization_reference) mô phỏng mã phiếu/ticket hỗ trợ đã được khách hàng xác nhận và phê duyệt trong quy trình vận hành.',
                  style: GoogleFonts.inter(
                    fontSize: 11.5,
                    color: const Color(0xFF92400E),
                  ),
                ),
              ),
            ],
          ),
        ),

        const SizedBox(height: 16),

        // Chốt an ninh Mật khẩu Quản trị viên
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: const Color(0xFFFEF2F2),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: const Color(0xFFFECACA)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(
                    Icons.lock_outline_rounded,
                    size: 16,
                    color: Color(0xFFDC2626),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      'Xác thực Mật khẩu Quản trị viên (Security Gate)',
                      style: GoogleFonts.inter(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: const Color(0xFF991B1B),
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                'Thao tác này sẽ khóa dòng dữ liệu hai ví, trừ tiền trực tiếp từ ví nguồn và ghi nhận nhật ký kiểm toán.',
                style: GoogleFonts.inter(
                  fontSize: 11.5,
                  color: const Color(0xFFB91C1C),
                ),
              ),
              const SizedBox(height: 10),
              TextFormField(
                controller: _adminPasswordController,
                obscureText: _obscurePassword,
                enabled: !_isSubmitting,
                onFieldSubmitted: (_) => _handleSubmitTransfer(),
                style: GoogleFonts.inter(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                ),
                decoration: InputDecoration(
                  hintText: 'Nhập mật khẩu Admin để ký duyệt lệnh chuyển...',
                  hintStyle: GoogleFonts.inter(
                    fontSize: 12.5,
                    color: AppColors.textMuted,
                  ),
                  filled: true,
                  fillColor: Colors.white,
                  contentPadding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  suffixIcon: IconButton(
                    onPressed: () {
                      setState(() => _obscurePassword = !_obscurePassword);
                    },
                    icon: Icon(
                      _obscurePassword
                          ? Icons.visibility_off_outlined
                          : Icons.visibility_outlined,
                      size: 18,
                      color: AppColors.textMuted,
                    ),
                  ),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(6),
                    borderSide: const BorderSide(color: Color(0xFFFCA5A5)),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(6),
                    borderSide: const BorderSide(color: Color(0xFFFCA5A5)),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(6),
                    borderSide:
                        const BorderSide(color: Color(0xFFDC2626), width: 1.5),
                  ),
                ),
              ),
            ],
          ),
        ),

        if (_submitError != null) ...[
          const SizedBox(height: 14),
          _buildErrorBanner(
            _submitError!,
            isWarning: _isNetworkRetryPending,
          ),
        ],
      ],
    );
  }

  Widget _buildSummaryRow(
    String label,
    String value, {
    Color? valueColor,
    bool isBoldValue = false,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 130,
          child: Text(
            label,
            style: GoogleFonts.inter(
              fontSize: 12,
              fontWeight: FontWeight.w500,
              color: AppColors.textSecondary,
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Text(
            value,
            textAlign: TextAlign.right,
            style: GoogleFonts.inter(
              fontSize: 12.5,
              fontWeight: isBoldValue ? FontWeight.w700 : FontWeight.w600,
              color: valueColor ?? AppColors.textPrimary,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildErrorBanner(String message, {bool isWarning = false}) {
    final bgColor =
        isWarning ? const Color(0xFFFFFBEB) : const Color(0xFFFEF2F2);
    final borderColor =
        isWarning ? const Color(0xFFFDE68A) : const Color(0xFFFECACA);
    final textColor =
        isWarning ? const Color(0xFF92400E) : const Color(0xFFB91C1C);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: borderColor),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            isWarning
                ? Icons.wifi_off_rounded
                : Icons.warning_amber_rounded,
            size: 18,
            color: textColor,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: GoogleFonts.inter(
                fontSize: 12,
                fontWeight: FontWeight.w500,
                color: textColor,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFooter() {
    if (_currentStep == 1) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.end,
          children: [
            OutlinedButton(
              onPressed: _handleClose,
              style: OutlinedButton.styleFrom(
                padding:
                    const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                side: const BorderSide(color: AppColors.borderStrong),
                shape: RoundedRectangleBorder(
                  borderRadius: AppDimensions.borderRadiusMd,
                ),
              ),
              child: Text(
                'Hủy bỏ',
                style: GoogleFonts.inter(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textSecondary,
                ),
              ),
            ),
            const SizedBox(width: 12),
            ElevatedButton.icon(
              onPressed: _isRecipientValid ? _handleProceedToStep2 : null,
              icon: const Icon(Icons.arrow_forward_rounded, size: 16),
              label: Text(
                'Tiếp tục xác nhận',
                style: GoogleFonts.inter(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                ),
              ),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF0950C4),
                foregroundColor: Colors.white,
                disabledBackgroundColor: const Color(0xFFCBD5E1),
                disabledForegroundColor: const Color(0xFF64748B),
                padding:
                    const EdgeInsets.symmetric(horizontal: 22, vertical: 12),
                elevation: 0,
                shape: RoundedRectangleBorder(
                  borderRadius: AppDimensions.borderRadiusMd,
                ),
              ),
            ),
          ],
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          Flexible(
            child: OutlinedButton.icon(
              onPressed: _isSubmitting ? null : _handleBackToStep1,
              icon: const Icon(Icons.arrow_back_rounded, size: 16),
              label: Text(
                'Quay lại chỉnh sửa',
                style: GoogleFonts.inter(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textSecondary,
                ),
                overflow: TextOverflow.ellipsis,
              ),
              style: OutlinedButton.styleFrom(
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                side: const BorderSide(color: AppColors.borderStrong),
                shape: RoundedRectangleBorder(
                  borderRadius: AppDimensions.borderRadiusMd,
                ),
              ),
            ),
          ),
          const SizedBox(width: 12),
          Flexible(
            child: ElevatedButton.icon(
              onPressed: _isSubmitting ? null : _handleSubmitTransfer,
              icon: _isSubmitting
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.verified_user_outlined, size: 16),
              label: Text(
                _isSubmitting
                    ? 'Đang xử lý giao dịch...'
                    : (_isNetworkRetryPending
                        ? 'Gửi Lại Lệnh Chuyển (Cùng Key)'
                        : 'Xác Nhận & Thực Hiện Lệnh Chuyển'),
                style: GoogleFonts.inter(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                ),
                overflow: TextOverflow.ellipsis,
              ),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF0950C4),
                foregroundColor: Colors.white,
                padding:
                    const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
                elevation: 0,
                shape: RoundedRectangleBorder(
                  borderRadius: AppDimensions.borderRadiusMd,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLabel(String text, {bool isRequired = false}) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Flexible(
          child: Text(
            text,
            style: GoogleFonts.inter(
              fontSize: 12.5,
              fontWeight: FontWeight.w600,
              color: AppColors.textPrimary,
            ),
            overflow: TextOverflow.ellipsis,
          ),
        ),
        if (isRequired) ...[
          const SizedBox(width: 4),
          const Text(
            '*',
            style: TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.bold,
              color: AppColors.danger,
            ),
          ),
        ],
      ],
    );
  }

  Widget _buildQuickAmountChip(
    String label,
    int amount, {
    bool isSelected = false,
  }) {
    return InkWell(
      onTap: () => _setAmount(amount),
      borderRadius: BorderRadius.circular(6),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color:
              isSelected ? const Color(0xFFEBF3FC) : const Color(0xFFF1F5F9),
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
            fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
            color:
                isSelected ? const Color(0xFF0950C4) : const Color(0xFF475569),
          ),
        ),
      ),
    );
  }

  InputDecoration _inputDecoration({
    required String hintText,
    IconData? prefixIcon,
    String? suffixText,
  }) {
    return InputDecoration(
      hintText: hintText,
      hintStyle: GoogleFonts.inter(
        fontSize: 12.5,
        color: AppColors.textMuted,
      ),
      prefixIcon: prefixIcon != null
          ? Icon(prefixIcon, size: 18, color: AppColors.textMuted)
          : null,
      suffixText: suffixText,
      suffixStyle: GoogleFonts.inter(
        fontSize: 12,
        fontWeight: FontWeight.w700,
        color: AppColors.textSecondary,
      ),
      filled: true,
      fillColor: AppColors.surfaceMuted,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      border: OutlineInputBorder(
        borderRadius: AppDimensions.borderRadiusMd,
        borderSide: const BorderSide(color: AppColors.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: AppDimensions.borderRadiusMd,
        borderSide: const BorderSide(color: AppColors.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: AppDimensions.borderRadiusMd,
        borderSide: const BorderSide(color: AppColors.primary, width: 1.5),
      ),
    );
  }
}

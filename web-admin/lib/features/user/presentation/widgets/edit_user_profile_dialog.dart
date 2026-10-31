import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_dimensions.dart';
import '../../models/user_model.dart';

class EditUserProfileDialog extends StatefulWidget {
  final UserModel user;
  final Future<void> Function({
    required String? fullName,
    required String? phone,
    required String? email,
    required String reason,
  }) onSave;

  const EditUserProfileDialog({
    super.key,
    required this.user,
    required this.onSave,
  });

  static Future<bool?> show(
    BuildContext context, {
    required UserModel user,
    required Future<void> Function({
      required String? fullName,
      required String? phone,
      required String? email,
      required String reason,
    }) onSave,
  }) {
    return showDialog<bool>(
      context: context,
      barrierDismissible: false,
      barrierColor: const Color(0x7F0F172A),
      builder: (ctx) => EditUserProfileDialog(
        user: user,
        onSave: onSave,
      ),
    );
  }

  @override
  State<EditUserProfileDialog> createState() => _EditUserProfileDialogState();
}

class _EditUserProfileDialogState extends State<EditUserProfileDialog> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _nameController;
  late final TextEditingController _phoneController;
  late final TextEditingController _emailController;
  late final TextEditingController _reasonController;

  bool _isSubmitting = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.user.name);
    _phoneController = TextEditingController(text: widget.user.phone);
    _emailController = TextEditingController(text: widget.user.email);
    _reasonController = TextEditingController();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _phoneController.dispose();
    _emailController.dispose();
    _reasonController.dispose();
    super.dispose();
  }

  Future<void> _handleSubmit() async {
    if (_isSubmitting) return;

    final hasChanges = _nameController.text.trim() != widget.user.name ||
        _phoneController.text.trim() != widget.user.phone ||
        _emailController.text.trim() != widget.user.email;

    if (!hasChanges) {
      setState(() {
        _errorMessage = 'Bạn chưa thay đổi bất kỳ trường thông tin nào.';
      });
      return;
    }

    if (!_formKey.currentState!.validate()) {
      return;
    }

    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });

    try {
      await widget.onSave(
        fullName: _nameController.text.trim(),
        phone: _phoneController.text.trim(),
        email: _emailController.text.trim(),
        reason: _reasonController.text.trim(),
      );

      if (mounted) {
        Navigator.of(context).pop(true);
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isSubmitting = false;
          _errorMessage = e.toString();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final isKycVerified = widget.user.kycStatus == KycStatus.verified;

    return Dialog(
      backgroundColor: Colors.transparent,
      elevation: 0,
      insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
      child: Container(
        width: 500,
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: AppDimensions.borderRadiusMd,
          boxShadow: AppDimensions.dialogShadow,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // 1. Header
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 20, 16, 16),
              child: Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: AppColors.primaryContainer,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: const Icon(
                      Icons.manage_accounts_rounded,
                      color: AppColors.primary,
                      size: 22,
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Chỉnh sửa thông tin người dùng',
                          style: GoogleFonts.inter(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                            color: AppColors.textPrimary,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          'Cập nhật hồ sơ định danh trực tiếp cho tài khoản',
                          style: GoogleFonts.inter(
                            fontSize: 12.5,
                            color: AppColors.textSecondary,
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: _isSubmitting ? null : () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close, size: 20),
                    color: AppColors.textMuted,
                    splashRadius: 20,
                  ),
                ],
              ),
            ),
            const Divider(height: 1, color: AppColors.border),

            // 2. Scrollable Form Body
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(24),
                child: Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Warning KYC Banner (if verified)
                      if (isKycVerified) ...[
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: AppColors.warningBg,
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: AppColors.warningBorder),
                          ),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Icon(
                                Icons.warning_amber_rounded,
                                color: AppColors.warningText,
                                size: 20,
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Text(
                                  'Tài khoản này đã hoàn tất xác thực định danh (KYC). Việc thay đổi Họ tên, SĐT hoặc Email có thể ảnh hưởng đến sự khớp nối với giấy tờ tùy thân. Vui lòng xác minh kỹ trước khi lưu.',
                                  style: GoogleFonts.inter(
                                    fontSize: 12,
                                    color: AppColors.warningText,
                                    height: 1.4,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 16),
                      ],

                      // Session revocation note
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: AppColors.primaryContainer.withValues(alpha: 0.5),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                            color: AppColors.primary.withValues(alpha: 0.2),
                          ),
                        ),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Icon(
                              Icons.info_outline_rounded,
                              color: AppColors.primary,
                              size: 18,
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                'Lưu ý: Nếu thay đổi SĐT hoặc Email, người dùng sẽ bị thu hồi phiên đăng nhập ngay lập tức trên ứng dụng di động để đảm bảo an toàn.',
                                style: GoogleFonts.inter(
                                  fontSize: 12,
                                  color: AppColors.primaryHover,
                                  height: 1.35,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 20),

                      // Error message if any
                      if (_errorMessage != null) ...[
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: AppColors.dangerBg,
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: AppColors.dangerBorder),
                          ),
                          child: Row(
                            children: [
                              const Icon(
                                Icons.error_outline_rounded,
                                color: AppColors.danger,
                                size: 18,
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Text(
                                  _errorMessage!,
                                  style: GoogleFonts.inter(
                                    fontSize: 12.5,
                                    color: AppColors.dangerText,
                                    fontWeight: FontWeight.w500,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 16),
                      ],

                      // Field: Full Name
                      _buildLabel('Họ và tên', isRequired: true),
                      const SizedBox(height: 6),
                      TextFormField(
                        controller: _nameController,
                        enabled: !_isSubmitting,
                        decoration: _inputDecoration(
                          hintText: 'Nhập họ và tên người dùng',
                          prefixIcon: Icons.person_outline,
                        ),
                        validator: (value) {
                          if (value == null || value.trim().isEmpty) {
                            return 'Vui lòng nhập họ và tên';
                          }
                          return null;
                        },
                      ),
                      const SizedBox(height: 16),

                      // Field: Phone
                      _buildLabel('Số điện thoại', isRequired: true),
                      const SizedBox(height: 6),
                      TextFormField(
                        controller: _phoneController,
                        enabled: !_isSubmitting,
                        keyboardType: TextInputType.phone,
                        decoration: _inputDecoration(
                          hintText: 'Nhập số điện thoại (10 chữ số)',
                          prefixIcon: Icons.phone_outlined,
                        ),
                        validator: (value) {
                          if (value == null || value.trim().isEmpty) {
                            return 'Vui lòng nhập số điện thoại';
                          }
                          final clean = value.trim();
                          if (!RegExp(r'^0[0-9]{9}$').hasMatch(clean)) {
                            return 'Số điện thoại phải gồm 10 chữ số và bắt đầu bằng số 0';
                          }
                          return null;
                        },
                      ),
                      const SizedBox(height: 16),

                      // Field: Email
                      _buildLabel('Địa chỉ Email', isRequired: true),
                      const SizedBox(height: 6),
                      TextFormField(
                        controller: _emailController,
                        enabled: !_isSubmitting,
                        keyboardType: TextInputType.emailAddress,
                        decoration: _inputDecoration(
                          hintText: 'Nhập địa chỉ email người dùng',
                          prefixIcon: Icons.email_outlined,
                        ),
                        validator: (value) {
                          if (value == null || value.trim().isEmpty) {
                            return 'Vui lòng nhập địa chỉ email';
                          }
                          final clean = value.trim();
                          if (!RegExp(r'^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$').hasMatch(clean)) {
                            return 'Địa chỉ email không đúng định dạng';
                          }
                          return null;
                        },
                      ),
                      const SizedBox(height: 16),

                      // Field: Reason
                      _buildLabel('Lý do chỉnh sửa', isRequired: true),
                      const SizedBox(height: 6),
                      TextFormField(
                        controller: _reasonController,
                        enabled: !_isSubmitting,
                        maxLines: 3,
                        decoration: _inputDecoration(
                          hintText: 'Nhập lý do thực hiện cập nhật thông tin này (bắt buộc lưu audit log)...',
                        ),
                        validator: (value) {
                          if (value == null || value.trim().isEmpty) {
                            return 'Vui lòng nhập lý do chỉnh sửa (bắt buộc)';
                          }
                          return null;
                        },
                      ),
                    ],
                  ),
                ),
              ),
            ),

            // 3. Footer
            const Divider(height: 1, color: AppColors.border),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  OutlinedButton(
                    onPressed: _isSubmitting ? null : () => Navigator.of(context).pop(),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                      side: const BorderSide(color: AppColors.borderStrong),
                      shape: RoundedRectangleBorder(
                        borderRadius: AppDimensions.borderRadiusMd,
                      ),
                    ),
                    child: Text(
                      'Hủy bỏ',
                      style: GoogleFonts.inter(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  ElevatedButton(
                    onPressed: _isSubmitting ? null : _handleSubmit,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.primary,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                      elevation: 0,
                      shape: RoundedRectangleBorder(
                        borderRadius: AppDimensions.borderRadiusMd,
                      ),
                    ),
                    child: _isSubmitting
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : Text(
                            'Lưu thay đổi',
                            style: GoogleFonts.inter(
                              fontSize: 13.5,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildLabel(String text, {bool isRequired = false}) {
    return Row(
      children: [
        Text(
          text,
          style: GoogleFonts.inter(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: AppColors.textPrimary,
          ),
        ),
        if (isRequired) ...[
          const SizedBox(width: 4),
          const Text(
            '*',
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.bold,
              color: AppColors.danger,
            ),
          ),
        ],
      ],
    );
  }

  InputDecoration _inputDecoration({
    required String hintText,
    IconData? prefixIcon,
  }) {
    return InputDecoration(
      hintText: hintText,
      hintStyle: GoogleFonts.inter(
        fontSize: 13,
        color: AppColors.textMuted,
      ),
      prefixIcon: prefixIcon != null
          ? Icon(prefixIcon, size: 18, color: AppColors.textMuted)
          : null,
      filled: true,
      fillColor: AppColors.surfaceMuted,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
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
      errorBorder: OutlineInputBorder(
        borderRadius: AppDimensions.borderRadiusMd,
        borderSide: const BorderSide(color: AppColors.danger),
      ),
      focusedErrorBorder: OutlineInputBorder(
        borderRadius: AppDimensions.borderRadiusMd,
        borderSide: const BorderSide(color: AppColors.danger, width: 1.5),
      ),
    );
  }
}

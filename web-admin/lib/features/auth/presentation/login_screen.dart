import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_dimensions.dart';
import '../../../core/theme/app_typography.dart';
import '../data/auth_api_service.dart';
import '../models/admin_session_model.dart';

enum AlertBannerType { none, error, success }

class LoginScreen extends StatefulWidget {
  final void Function(AdminSessionModel session) onLoginSuccess;

  const LoginScreen({super.key, required this.onLoginSuccess});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final TextEditingController _emailController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();

  final FocusNode _emailFocus = FocusNode();
  final FocusNode _passwordFocus = FocusNode();

  final AuthApiService _authService = AuthApiService();

  bool _isLoading = false;
  String? _emailError;
  String? _passwordError;
  AlertBannerType _bannerType = AlertBannerType.none;
  String? _bannerMessage;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    _emailFocus.dispose();
    _passwordFocus.dispose();
    super.dispose();
  }

  void _resetErrors() {
    setState(() {
      _emailError = null;
      _passwordError = null;
      _bannerType = AlertBannerType.none;
      _bannerMessage = null;
    });
  }

  bool _isValidEmail(String email) {
    final emailRegex = RegExp(r'^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$');
    return emailRegex.hasMatch(email);
  }

  Future<void> _handleSubmit() async {
    if (_isLoading) return;

    final email = _emailController.text.trim();
    final password = _passwordController.text.trim();

    _resetErrors();

    bool hasError = false;
    if (email.isEmpty) {
      _emailError = 'Vui lòng nhập email quản trị';
      hasError = true;
    } else if (!_isValidEmail(email)) {
      _emailError = 'Định dạng email không hợp lệ';
      hasError = true;
    }

    if (password.isEmpty) {
      _passwordError = 'Vui lòng nhập mật khẩu';
      hasError = true;
    }

    if (hasError) {
      setState(() {
        _bannerType = AlertBannerType.error;
        _bannerMessage = _emailError != null && _passwordError != null
            ? 'Không thể bỏ trống thông tin: Vui lòng điền đầy đủ email và mật khẩu quản trị.'
            : (_emailError ?? _passwordError);
      });
      return;
    }

    setState(() {
      _isLoading = true;
    });

    try {
      final session = await _authService.login(
        email: email,
        password: password,
      );

      if (!mounted) return;

      setState(() {
        _isLoading = false;
        _bannerType = AlertBannerType.success;
        _bannerMessage =
            'Đăng nhập Admin thành công! Đang chuyển hướng đến Dashboard...';
      });

      Future.delayed(const Duration(milliseconds: 600), () {
        if (!mounted) return;
        widget.onLoginSuccess(session);
      });
    } on AuthApiException catch (e) {
      if (!mounted) return;

      setState(() {
        _isLoading = false;
        _bannerType = AlertBannerType.error;
        _bannerMessage = e.message;
        if (e.statusCode == 400 &&
            e.message.toLowerCase().contains('mật khẩu')) {
          _passwordError = e.message;
        } else if (e.statusCode == 404) {
          _emailError = e.message;
        }
      });
    } catch (e) {
      if (!mounted) return;

      setState(() {
        _isLoading = false;
        _bannerType = AlertBannerType.error;
        _bannerMessage = 'Đã có lỗi không mong muốn xảy ra: $e';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: Column(
        children: [
          // 1. Top Security / Environment Header
          _buildSecurityHeader(),

          // 2. Main Centered Login Container
          Expanded(
            child: Center(
              child: ScrollConfiguration(
                behavior: ScrollConfiguration.of(
                  context,
                ).copyWith(scrollbars: false),
                child: SingleChildScrollView(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 24,
                  ),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(
                      maxWidth: AppDimensions.dialogWidth,
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        // Header & Brand Logo
                        _buildBrandHeader(),
                        const SizedBox(height: 28),

                        // Login Card Form
                        _buildLoginCard(),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),

          // 3. Global Footer
          _buildFooter(),
        ],
      ),
    );
  }

  Widget _buildSecurityHeader() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
      decoration: const BoxDecoration(color: Colors.transparent),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          // Left: System & Environment Indicator
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 8,
                height: 8,
                decoration: const BoxDecoration(
                  color: AppColors.success,
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 8),
              Text(
                'Cổng Quản trị Nội bộ',
                style: AppTypography.bodySmall(
                  color: AppColors.textSecondary,
                ).copyWith(fontWeight: FontWeight.w500),
              ),
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 8),
                child: Text(
                  '|',
                  style: TextStyle(color: AppColors.borderStrong),
                ),
              ),
              RichText(
                text: TextSpan(
                  style: AppTypography.bodySmall(
                    color: AppColors.textSecondary,
                  ),
                  children: [
                    const TextSpan(text: 'Môi trường: '),
                    TextSpan(
                      text: 'Sản xuất (Production)',
                      style: AppTypography.bodySmall(
                        color: AppColors.textPrimary,
                      ).copyWith(fontWeight: FontWeight.w600),
                    ),
                  ],
                ),
              ),
            ],
          ),

          // Right: SSL Security Badge
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(
                Icons.lock_outline,
                size: 14,
                color: AppColors.textMuted,
              ),
              const SizedBox(width: 6),
              Text(
                'Bảo mật kết nối SSL/TLS 256-bit',
                style: AppTypography.bodySmall(color: AppColors.textMuted),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildBrandHeader() {
    return Column(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: AppColors.primary,
                borderRadius: BorderRadius.circular(12),
                boxShadow: const [
                  BoxShadow(
                    color: Color.fromRGBO(0, 82, 204, 0.25),
                    blurRadius: 10,
                    offset: Offset(0, 4),
                  ),
                ],
              ),
              child: const Icon(
                Icons.account_balance_wallet_outlined,
                color: Colors.white,
                size: 24,
              ),
            ),
            const SizedBox(width: 12),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'E-Wallet Admin',
                  style: AppTypography.headlineMedium().copyWith(
                    fontWeight: FontWeight.w700,
                    letterSpacing: -0.5,
                  ),
                ),
                Text(
                  'HỆ THỐNG QUẢN TRỊ VÍ',
                  style: AppTypography.labelMedium(
                    color: AppColors.textMuted,
                  ).copyWith(fontSize: 11, letterSpacing: 1.1),
                ),
              ],
            ),
          ],
        ),
        const SizedBox(height: 12),
        Text(
          'Đăng nhập quản trị',
          style: AppTypography.headlineLarge().copyWith(
            fontWeight: FontWeight.w700,
            letterSpacing: -0.5,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          'Đăng nhập để truy cập hệ thống quản trị ví điện tử',
          style: AppTypography.bodyMedium(color: AppColors.textSecondary),
          textAlign: TextAlign.center,
        ),
      ],
    );
  }

  Widget _buildLoginCard() {
    return Container(
      padding: const EdgeInsets.all(32),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border, width: 1),
        boxShadow: const [
          BoxShadow(
            color: Color.fromRGBO(0, 0, 0, 0.04),
            blurRadius: 30,
            offset: Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Alert Notification Banner (Dynamic for validation / auth feedback)
          if (_bannerType != AlertBannerType.none &&
              _bannerMessage != null) ...[
            _buildAlertBanner(),
            const SizedBox(height: 20),
          ],

          // Field 1: Email quản trị
          _buildFieldLabel('Email quản trị'),
          const SizedBox(height: 6),
          TextField(
            controller: _emailController,
            focusNode: _emailFocus,
            keyboardType: TextInputType.emailAddress,
            enabled: !_isLoading,
            style: AppTypography.bodyMedium(),
            decoration: _inputDecoration(
              hintText: 'email@ewallet.com',
              hasError: _emailError != null,
            ),
            onSubmitted: (_) => _handleSubmit(),
          ),
          if (_emailError != null) ...[
            const SizedBox(height: 6),
            _buildInlineError(_emailError!),
          ],

          const SizedBox(height: 20),

          // Field 2: Password
          _buildFieldLabel('Mật khẩu'),
          const SizedBox(height: 6),
          TextField(
            controller: _passwordController,
            focusNode: _passwordFocus,
            obscureText: true,
            enabled: !_isLoading,
            style: AppTypography.bodyMedium(),
            decoration: _inputDecoration(
              hintText: 'Nhập mật khẩu',
              hasError: _passwordError != null,
            ),
            onSubmitted: (_) => _handleSubmit(),
          ),
          if (_passwordError != null) ...[
            const SizedBox(height: 6),
            _buildInlineError(_passwordError!),
          ],

          const SizedBox(height: 24),

          // Submit Button
          SizedBox(
            width: double.infinity,
            height: 44,
            child: ElevatedButton(
              onPressed: _isLoading ? null : _handleSubmit,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: Colors.white,
                disabledBackgroundColor: const Color(0xA60052CC),
                elevation: 0,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              child: _isLoading
                  ? Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        ),
                        const SizedBox(width: 10),
                        Text(
                          'Đang xác thực tài khoản...',
                          style: AppTypography.titleSmall(
                            color: Colors.white,
                          ).copyWith(fontSize: 14),
                        ),
                      ],
                    )
                  : Text(
                      'Đăng nhập',
                      style: AppTypography.titleSmall(
                        color: Colors.white,
                      ).copyWith(fontSize: 14, fontWeight: FontWeight.w600),
                    ),
            ),
          ),

          const SizedBox(height: 24),

          // PCI-DSS Security Compliance Note
          Container(
            padding: const EdgeInsets.only(top: 20),
            decoration: const BoxDecoration(
              border: Border(
                top: BorderSide(color: AppColors.border, width: 1),
              ),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(
                  Icons.shield_outlined,
                  size: 15,
                  color: AppColors.textMuted,
                ),
                const SizedBox(width: 6),
                Flexible(
                  child: Text(
                    'Tuân thủ tiêu chuẩn an ninh thanh toán PCI-DSS',
                    style: AppTypography.bodySmall(color: AppColors.textMuted),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFieldLabel(String label) {
    return RichText(
      text: TextSpan(
        style: AppTypography.labelMedium(
          color: AppColors.textPrimary,
        ).copyWith(fontWeight: FontWeight.w600),
        children: [
          TextSpan(text: label),
          const TextSpan(
            text: ' *',
            style: TextStyle(
              color: AppColors.danger,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }

  InputDecoration _inputDecoration({
    required String hintText,
    required bool hasError,
  }) {
    return InputDecoration(
      hintText: hintText,
      hintStyle: AppTypography.bodyMedium(color: AppColors.textMuted),
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: BorderSide(
          color: hasError ? AppColors.danger : AppColors.borderStrong,
          width: 1,
        ),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: BorderSide(
          color: hasError ? AppColors.danger : AppColors.primary,
          width: 1.5,
        ),
      ),
      disabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: AppColors.border, width: 1),
      ),
    );
  }

  Widget _buildInlineError(String error) {
    return Row(
      children: [
        const Icon(Icons.error_outline, size: 14, color: AppColors.danger),
        const SizedBox(width: 4),
        Expanded(
          child: Text(
            error,
            style: AppTypography.bodySmall(
              color: AppColors.danger,
            ).copyWith(fontSize: 12, fontWeight: FontWeight.w500),
          ),
        ),
      ],
    );
  }

  Widget _buildAlertBanner() {
    final isSuccess = _bannerType == AlertBannerType.success;
    final bg = isSuccess ? AppColors.successBg : AppColors.dangerBg;
    final border = isSuccess ? AppColors.successBorder : AppColors.dangerBorder;
    final text = isSuccess ? AppColors.successText : AppColors.dangerText;
    final icon = isSuccess ? Icons.check_circle_outline : Icons.error_outline;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: border, width: 1),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: text),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              _bannerMessage ?? '',
              style: AppTypography.bodySmall(
                color: text,
              ).copyWith(fontWeight: FontWeight.w500, height: 1.4),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFooter() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
      child: Text(
        '© 2026 E-Wallet Platform. Bản quyền thuộc về Hệ thống Quản trị Ví điện tử.',
        style: AppTypography.bodySmall(color: AppColors.textMuted),
        textAlign: TextAlign.center,
      ),
    );
  }
}

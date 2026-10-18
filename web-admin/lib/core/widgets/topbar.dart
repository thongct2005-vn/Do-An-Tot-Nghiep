import 'package:flutter/material.dart';
import '../theme/app_colors.dart';
import '../theme/app_dimensions.dart';
import '../theme/app_typography.dart';

class Topbar extends StatelessWidget {
  final String title;
  final String? subtitle;
  final String? adminName;
  final String? adminEmail;
  final VoidCallback? onLogout;

  const Topbar({
    super.key,
    required this.title,
    this.subtitle,
    this.adminName,
    this.adminEmail,
    this.onLogout,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      height: AppDimensions.topbarHeight,
      padding: const EdgeInsets.symmetric(horizontal: 24),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(
          bottom: BorderSide(color: AppColors.border, width: 1),
        ),
      ),
      child: Row(
        children: [
          // Breadcrumb / Title
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: AppTypography.headlineMedium(color: AppColors.textPrimary),
                  overflow: TextOverflow.ellipsis,
                ),
                if (subtitle != null)
                  Text(
                    subtitle!,
                    style: AppTypography.bodySmall(color: AppColors.textSecondary),
                    overflow: TextOverflow.ellipsis,
                  ),
              ],
            ),
          ),
          const SizedBox(width: 16),

          // System Status Pill
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: AppColors.successBg,
              borderRadius: AppDimensions.borderRadiusSm,
              border: Border.all(color: AppColors.successBorder),
            ),
            child: Row(
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
                const SizedBox(width: 6),
                Text(
                  'Hệ thống trực tuyến',
                  style: AppTypography.labelMedium(color: AppColors.successText),
                ),
              ],
            ),
          ),

          const SizedBox(width: 16),

          // Notification Bell
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: AppColors.surfaceMuted,
              borderRadius: AppDimensions.borderRadiusMd,
              border: Border.all(color: AppColors.border),
            ),
            child: const Icon(
              Icons.notifications_none,
              color: AppColors.textSecondary,
              size: 20,
            ),
          ),

          const SizedBox(width: 16),

          // Admin User Profile
          Row(
            children: [
              CircleAvatar(
                radius: 18,
                backgroundColor: AppColors.primaryContainer,
                child: Text(
                  (adminName != null && adminName!.isNotEmpty)
                      ? adminName!.substring(0, 1).toUpperCase()
                      : 'AD',
                  style: const TextStyle(
                    color: AppColors.primary,
                    fontWeight: FontWeight.w700,
                    fontSize: 13,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    adminName ?? 'Quản trị viên',
                    style: AppTypography.bodyMedium(color: AppColors.textPrimary).copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  Text(
                    adminEmail ?? 'admin@ewallet.com',
                    style: AppTypography.bodySmall(color: AppColors.textSecondary).copyWith(
                      fontSize: 11,
                    ),
                  ),
                ],
              ),
              if (onLogout != null) ...[
                const SizedBox(width: 12),
                IconButton(
                  icon: const Icon(Icons.logout, size: 18, color: AppColors.danger),
                  tooltip: 'Đăng xuất',
                  onPressed: onLogout,
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

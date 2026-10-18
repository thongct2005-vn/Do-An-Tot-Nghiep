import 'package:flutter/material.dart';
import '../theme/app_colors.dart';
import '../theme/app_dimensions.dart';
import '../theme/app_typography.dart';

enum AdminNavItem {
  dashboard,
  users,
  transactions,
}

class Sidebar extends StatelessWidget {
  final AdminNavItem currentItem;
  final ValueChanged<AdminNavItem> onItemSelected;

  const Sidebar({
    super.key,
    required this.currentItem,
    required this.onItemSelected,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: AppDimensions.sidebarWidth,
      height: double.infinity,
      color: AppColors.secondary,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Logo & Branding
          Container(
            height: AppDimensions.topbarHeight,
            padding: const EdgeInsets.symmetric(horizontal: 20),
            alignment: Alignment.centerLeft,
            decoration: const BoxDecoration(
              border: Border(
                bottom: BorderSide(color: Color(0x20FFFFFF), width: 1),
              ),
            ),
            child: Row(
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: AppDimensions.borderRadiusMd,
                  ),
                  child: const Icon(
                    Icons.account_balance_wallet,
                    color: AppColors.primary,
                    size: 22,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'E-Wallet Admin',
                        style: AppTypography.titleSmall(color: Colors.white),
                        overflow: TextOverflow.ellipsis,
                      ),
                      Text(
                        'Fintech Trust Engine',
                        style: AppTypography.bodySmall(
                          color: const Color(0xFFB2C5FF),
                        ).copyWith(fontSize: 11),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 16),

          // Navigation Items
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Text(
              'QUẢN TRỊ VẬN HÀNH',
              style: AppTypography.labelMedium(
                color: const Color(0xFF8FAEFF),
              ).copyWith(letterSpacing: 1.0, fontSize: 11),
            ),
          ),

          _buildNavItem(
            item: AdminNavItem.dashboard,
            icon: Icons.dashboard_outlined,
            activeIcon: Icons.dashboard,
            label: 'Tổng quan Dashboard',
          ),
          _buildNavItem(
            item: AdminNavItem.users,
            icon: Icons.people_outline,
            activeIcon: Icons.people,
            label: 'Quản lý người dùng',
          ),
          _buildNavItem(
            item: AdminNavItem.transactions,
            icon: Icons.receipt_long_outlined,
            activeIcon: Icons.receipt_long,
            label: 'Quản lý giao dịch',
          ),

          const Spacer(),

          // System Info / Footer
          Container(
            padding: const EdgeInsets.all(16),
            margin: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: const Color(0x15FFFFFF),
              borderRadius: AppDimensions.borderRadiusMd,
              border: Border.all(color: const Color(0x20FFFFFF)),
            ),
            child: Row(
              children: [
                const Icon(
                  Icons.verified_user_outlined,
                  color: Color(0xFF10B981),
                  size: 20,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        'Cổng Quản Trị Ví',
                        style: AppTypography.bodySmall(color: Colors.white).copyWith(
                          fontWeight: FontWeight.w600,
                          fontSize: 12,
                        ),
                      ),
                      Text(
                        'Bản chuẩn v1.0.0',
                        style: AppTypography.bodySmall(color: const Color(0xFFB2C5FF)).copyWith(
                          fontSize: 11,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildNavItem({
    required AdminNavItem item,
    required IconData icon,
    required IconData activeIcon,
    required String label,
  }) {
    final bool isActive = currentItem == item;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () => onItemSelected(item),
          borderRadius: AppDimensions.borderRadiusMd,
          hoverColor: const Color(0x15FFFFFF),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              color: isActive ? AppColors.primary : Colors.transparent,
              borderRadius: AppDimensions.borderRadiusMd,
              boxShadow: isActive
                  ? [
                      const BoxShadow(
                        color: Color(0x33000000),
                        blurRadius: 4,
                        offset: Offset(0, 2),
                      )
                    ]
                  : null,
            ),
            child: Row(
              children: [
                Icon(
                  isActive ? activeIcon : icon,
                  size: 20,
                  color: isActive ? Colors.white : const Color(0xFFD9E2FF),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    label,
                    style: AppTypography.bodyMedium(
                      color: isActive ? Colors.white : const Color(0xFFD9E2FF),
                    ).copyWith(
                      fontWeight: isActive ? FontWeight.w600 : FontWeight.w400,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

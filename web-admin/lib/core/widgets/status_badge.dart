import 'package:flutter/material.dart';
import '../theme/app_colors.dart';
import '../theme/app_dimensions.dart';
import '../theme/app_typography.dart';

enum BadgeStatus {
  success,
  pending,
  danger,
}

class StatusBadge extends StatelessWidget {
  final String label;
  final BadgeStatus status;

  const StatusBadge({
    super.key,
    required this.label,
    required this.status,
  });

  @override
  Widget build(BuildContext context) {
    Color bg;
    Color border;
    Color text;
    Color dot;

    switch (status) {
      case BadgeStatus.success:
        bg = AppColors.successBg;
        border = AppColors.successBorder;
        text = AppColors.successText;
        dot = AppColors.success;
        break;
      case BadgeStatus.pending:
        bg = AppColors.warningBg;
        border = AppColors.warningBorder;
        text = AppColors.warningText;
        dot = AppColors.warning;
        break;
      case BadgeStatus.danger:
        bg = AppColors.dangerBg;
        border = AppColors.dangerBorder;
        text = AppColors.dangerText;
        dot = AppColors.danger;
        break;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: AppDimensions.borderRadiusSm,
        border: Border.all(color: border, width: 1),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(
              color: dot,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              label,
              style: AppTypography.labelMedium(color: text).copyWith(
                fontSize: 12,
                fontWeight: FontWeight.w500,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

import 'package:flutter/material.dart';
import '../../../../core/mock/mock_dashboard_data.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_dimensions.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/widgets/financial_text.dart';

class KpiCard extends StatelessWidget {
  final KpiItemData data;
  final IconData icon;
  final Color iconColor;
  final Color iconBg;

  const KpiCard({
    super.key,
    required this.data,
    required this.icon,
    required this.iconColor,
    required this.iconBg,
  });

  @override
  Widget build(BuildContext context) {
    final bool isPositiveChange = data.changePercentage >= 0;

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: AppDimensions.borderRadiusMd,
        border: Border.all(color: AppColors.border, width: 1),
        boxShadow: AppDimensions.cardShadow,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          // Top Row: Title + Icon
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(
                  data.title,
                  style: AppTypography.bodySmall(color: AppColors.textSecondary).copyWith(
                    fontWeight: FontWeight.w500,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: iconBg,
                  borderRadius: AppDimensions.borderRadiusMd,
                ),
                child: Icon(icon, color: iconColor, size: 20),
              ),
            ],
          ),

          const SizedBox(height: 12),

          // Value (JetBrains Mono 28px)
          if (data.isCurrency)
            FinancialText(
              amount: data.value,
              variant: FinancialTextVariant.kpi,
              showSign: data.title == 'Dòng tiền ròng',
              textAlign: TextAlign.left,
            )
          else
            Text(
              FinancialText.formatVnd(data.value).replaceAll(' ₫', ''),
              style: AppTypography.currencyKpi(color: AppColors.textPrimary),
            ),

          const SizedBox(height: 12),

          // Bottom Row: % change & formula description
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: isPositiveChange ? AppColors.successBg : AppColors.dangerBg,
                  borderRadius: AppDimensions.borderRadiusSm,
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      isPositiveChange ? Icons.trending_up : Icons.trending_down,
                      size: 14,
                      color: isPositiveChange ? AppColors.success : AppColors.danger,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      '${isPositiveChange ? '+' : ''}${data.changePercentage}%',
                      style: AppTypography.labelMedium(
                        color: isPositiveChange ? AppColors.successText : AppColors.dangerText,
                      ).copyWith(fontSize: 11),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  data.formulaDescription,
                  style: AppTypography.monoCode(
                    color: AppColors.textMuted,
                    fontSize: 10,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

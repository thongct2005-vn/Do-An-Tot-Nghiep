import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../theme/app_colors.dart';
import '../theme/app_typography.dart';

enum FinancialTextVariant {
  kpi,
  display,
  cell,
}

class FinancialText extends StatelessWidget {
  final num amount;
  final FinancialTextVariant variant;
  final bool showSign;
  final Color? customColor;
  final TextAlign textAlign;

  const FinancialText({
    super.key,
    required this.amount,
    this.variant = FinancialTextVariant.cell,
    this.showSign = false,
    this.customColor,
    this.textAlign = TextAlign.right,
  });

  static String formatVnd(num value, {bool showSign = false}) {
    final formatter = NumberFormat('#,###', 'vi_VN');
    final formattedNumber = formatter.format(value.abs());
    final sign = value > 0 && showSign
        ? '+'
        : value < 0
            ? '-'
            : '';
    return '$sign$formattedNumber ₫';
  }

  @override
  Widget build(BuildContext context) {
    final String text = formatVnd(amount, showSign: showSign);

    Color defaultColor;
    if (customColor != null) {
      defaultColor = customColor!;
    } else if (showSign) {
      defaultColor = amount >= 0 ? AppColors.success : AppColors.danger;
    } else {
      defaultColor = AppColors.textPrimary;
    }

    TextStyle style;
    switch (variant) {
      case FinancialTextVariant.kpi:
        style = AppTypography.currencyKpi(color: defaultColor);
        break;
      case FinancialTextVariant.display:
        style = AppTypography.currencyDisplay(color: defaultColor);
        break;
      case FinancialTextVariant.cell:
        style = AppTypography.currencyCell(color: defaultColor);
        break;
    }

    return Text(
      text,
      textAlign: textAlign,
      style: style,
    );
  }
}

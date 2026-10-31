import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'app_colors.dart';

class AppTypography {
  // Financial Tabular Numbers (JetBrains Mono)
  static TextStyle currencyKpi({Color color = AppColors.textPrimary}) {
    return GoogleFonts.jetBrainsMono(
      fontSize: 28,
      fontWeight: FontWeight.w700,
      height: 36 / 28,
      color: color,
    );
  }

  static TextStyle currencyDisplay({Color color = AppColors.textPrimary}) {
    return GoogleFonts.jetBrainsMono(
      fontSize: 24,
      fontWeight: FontWeight.w600,
      height: 32 / 24,
      letterSpacing: -0.02,
      color: color,
    );
  }

  static TextStyle currencyCell({Color color = AppColors.textPrimary}) {
    return GoogleFonts.jetBrainsMono(
      fontSize: 13,
      fontWeight: FontWeight.w500,
      height: 20 / 13,
      color: color,
    );
  }

  static TextStyle monoCode({Color color = AppColors.textPrimary, double fontSize = 13}) {
    return GoogleFonts.jetBrainsMono(
      fontSize: fontSize,
      fontWeight: FontWeight.w500,
      height: 1.4,
      color: color,
    );
  }

  // General Interface Typography (Inter)
  static TextStyle displayLarge({Color color = AppColors.textPrimary}) {
    return GoogleFonts.inter(
      fontSize: 32,
      fontWeight: FontWeight.w700,
      height: 40 / 32,
      letterSpacing: -0.02,
      color: color,
    );
  }

  static TextStyle headlineLarge({Color color = AppColors.textPrimary}) {
    return GoogleFonts.inter(
      fontSize: 24,
      fontWeight: FontWeight.w600,
      height: 32 / 24,
      letterSpacing: -0.01,
      color: color,
    );
  }

  static TextStyle headlineMedium({Color color = AppColors.textPrimary}) {
    return GoogleFonts.inter(
      fontSize: 20,
      fontWeight: FontWeight.w600,
      height: 28 / 20,
      color: color,
    );
  }

  static TextStyle titleSmall({Color color = AppColors.textPrimary}) {
    return GoogleFonts.inter(
      fontSize: 16,
      fontWeight: FontWeight.w600,
      height: 24 / 16,
      color: color,
    );
  }

  static TextStyle bodyLarge({Color color = AppColors.textPrimary}) {
    return GoogleFonts.inter(
      fontSize: 15,
      fontWeight: FontWeight.w400,
      height: 22 / 15,
      color: color,
    );
  }

  static TextStyle bodyMedium({Color color = AppColors.textPrimary}) {
    return GoogleFonts.inter(
      fontSize: 14,
      fontWeight: FontWeight.w400,
      height: 20 / 14,
      color: color,
    );
  }

  static TextStyle bodySmall({Color color = AppColors.textSecondary}) {
    return GoogleFonts.inter(
      fontSize: 13,
      fontWeight: FontWeight.w400,
      height: 18 / 13,
      color: color,
    );
  }

  static TextStyle labelMedium({Color color = AppColors.textSecondary}) {
    return GoogleFonts.inter(
      fontSize: 12,
      fontWeight: FontWeight.w600,
      height: 16 / 12,
      letterSpacing: 0.04,
      color: color,
    );
  }
}

import 'package:flutter/material.dart';
import '../../../core/mock/mock_dashboard_data.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import 'widgets/kpi_card_grid.dart';
import 'widgets/tx_stats_chart.dart';

class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Section Heading
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Chỉ số Dòng tiền Trọng yếu (Financial KPIs)',
                      style: AppTypography.headlineMedium(color: AppColors.textPrimary),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Dữ liệu giám sát thời gian thực luân chuyển dòng tiền ví điện tử',
                      style: AppTypography.bodySmall(color: AppColors.textSecondary),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 16),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(color: AppColors.border),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.sync, size: 16, color: AppColors.primary),
                    const SizedBox(width: 6),
                    Text(
                      'Tự động đồng bộ: 30s',
                      style: AppTypography.labelMedium(color: AppColors.textPrimary),
                    ),
                  ],
                ),
              ),
            ],
          ),

          const SizedBox(height: 20),

          // 1. EXACTLY 5 KPI CARDS
          const KpiCardGrid(cards: MockDashboardData.kpiCards),

          const SizedBox(height: 24),

          // 2. TRANSACTION STATISTICS CHART DIRECTLY BELOW 5 KPI CARDS
          const TxStatsChart(),
        ],
      ),
    );
  }
}

import 'package:flutter/material.dart';
import '../../../../core/mock/mock_dashboard_data.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_dimensions.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/widgets/financial_text.dart';

enum ChartPeriod {
  today('Hôm nay'),
  week('7 ngày qua'),
  month('Tháng này');

  final String label;
  const ChartPeriod(this.label);
}

class TxStatsChart extends StatefulWidget {
  const TxStatsChart({super.key});

  @override
  State<TxStatsChart> createState() => _TxStatsChartState();
}

class _TxStatsChartState extends State<TxStatsChart> {
  ChartPeriod _selectedPeriod = ChartPeriod.week;
  int? _hoveredIndex;

  List<ChartPointData> get _currentData {
    switch (_selectedPeriod) {
      case ChartPeriod.today:
        return MockDashboardData.todayChartData;
      case ChartPeriod.week:
        return MockDashboardData.weekChartData;
      case ChartPeriod.month:
        return MockDashboardData.monthChartData;
    }
  }

  @override
  Widget build(BuildContext context) {
    final data = _currentData;
    num maxVal = 0;
    for (final p in data) {
      if (p.topupAmount > maxVal) maxVal = p.topupAmount;
      if (p.withdrawAmount > maxVal) maxVal = p.withdrawAmount;
      if (p.qrPaymentAmount > maxVal) maxVal = p.qrPaymentAmount;
    }
    if (maxVal == 0) maxVal = 1;

    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: AppDimensions.borderRadiusMd,
        border: Border.all(color: AppColors.border, width: 1),
        boxShadow: AppDimensions.cardShadow,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header Row
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Biểu đồ Thống kê Dòng tiền & Giao dịch',
                      style: AppTypography.titleSmall(color: AppColors.textPrimary),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Tương quan luân chuyển giữa Nạp tiền, Rút tiền, Thanh toán QR và Dòng tiền ròng',
                      style: AppTypography.bodySmall(color: AppColors.textSecondary),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 16),

              // Segmented Time Filter
              Container(
                decoration: BoxDecoration(
                  color: AppColors.surfaceMuted,
                  borderRadius: AppDimensions.borderRadiusSm,
                  border: Border.all(color: AppColors.borderStrong),
                ),
                padding: const EdgeInsets.all(3),
                child: Row(
                  children: ChartPeriod.values.map((period) {
                    final bool isSelected = _selectedPeriod == period;
                    return InkWell(
                      onTap: () {
                        setState(() {
                          _selectedPeriod = period;
                          _hoveredIndex = null;
                        });
                      },
                      borderRadius: AppDimensions.borderRadiusSm,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                        decoration: BoxDecoration(
                          color: isSelected ? AppColors.surface : Colors.transparent,
                          borderRadius: AppDimensions.borderRadiusSm,
                          boxShadow: isSelected
                              ? [
                                  const BoxShadow(
                                    color: Color(0x15000000),
                                    blurRadius: 3,
                                    offset: Offset(0, 1),
                                  )
                                ]
                              : null,
                        ),
                        child: Text(
                          period.label,
                          style: AppTypography.labelMedium(
                            color: isSelected ? AppColors.primary : AppColors.textSecondary,
                          ).copyWith(
                            fontWeight: isSelected ? FontWeight.w600 : FontWeight.w500,
                          ),
                        ),
                      ),
                    );
                  }).toList(),
                ),
              ),
            ],
          ),

          const SizedBox(height: 24),

          // Chart Canvas
          SizedBox(
            height: 260,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: List.generate(data.length, (idx) {
                final point = data[idx];
                final bool isHovered = _hoveredIndex == idx;

                return Expanded(
                  child: MouseRegion(
                    onEnter: (_) => setState(() => _hoveredIndex = idx),
                    onExit: (_) => setState(() => _hoveredIndex = null),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        // Tooltip on Hover
                        if (isHovered)
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            margin: const EdgeInsets.only(bottom: 6),
                            decoration: BoxDecoration(
                              color: AppColors.textPrimary,
                              borderRadius: AppDimensions.borderRadiusSm,
                            ),
                            child: Text(
                              'Ròng: ${FinancialText.formatVnd(point.netAmount, showSign: true)}',
                              style: AppTypography.monoCode(
                                color: Colors.white,
                                fontSize: 10,
                              ),
                            ),
                          )
                        else
                          const SizedBox(height: 22),

                        // Bars Group
                        SizedBox(
                          height: 180,
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              _buildBar(
                                heightRatio: point.topupAmount / maxVal,
                                color: AppColors.success,
                                label: 'Nạp',
                              ),
                              const SizedBox(width: 4),
                              _buildBar(
                                heightRatio: point.withdrawAmount / maxVal,
                                color: const Color(0xFFF97316),
                                label: 'Rút',
                              ),
                              const SizedBox(width: 4),
                              _buildBar(
                                heightRatio: point.qrPaymentAmount / maxVal,
                                color: const Color(0xFF8B5CF6),
                                label: 'QR',
                              ),
                            ],
                          ),
                        ),

                        const SizedBox(height: 8),

                        // X-Axis Label
                        Text(
                          point.timeLabel,
                          style: AppTypography.bodySmall(
                            color: isHovered ? AppColors.primary : AppColors.textSecondary,
                          ).copyWith(
                            fontWeight: isHovered ? FontWeight.w600 : FontWeight.w400,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              }),
            ),
          ),

          const SizedBox(height: 20),
          const Divider(),
          const SizedBox(height: 12),

          // Legend Row
          Wrap(
            alignment: WrapAlignment.center,
            spacing: 24,
            runSpacing: 8,
            children: [
              _buildLegend(AppColors.success, 'Tổng nạp (TOPUP)'),
              _buildLegend(const Color(0xFFF97316), 'Tổng rút (WITHDRAW)'),
              _buildLegend(const Color(0xFF8B5CF6), 'Thanh toán QR (PAYMENT)'),
              _buildLegend(AppColors.primary, 'Dòng tiền ròng (Nạp - Rút)', isLine: true),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildBar({
    required double heightRatio,
    required Color color,
    required String label,
  }) {
    final double clampedHeight = (heightRatio * 170).clamp(4.0, 170.0);
    return Container(
      width: 14,
      height: clampedHeight,
      decoration: BoxDecoration(
        color: color,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(3)),
      ),
    );
  }

  Widget _buildLegend(Color color, String label, {bool isLine = false}) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (isLine)
          Container(
            width: 16,
            height: 3,
            decoration: BoxDecoration(
              color: color,
              borderRadius: BorderRadius.circular(2),
            ),
          )
        else
          Container(
            width: 10,
            height: 10,
            decoration: BoxDecoration(
              color: color,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
        const SizedBox(width: 6),
        Text(
          label,
          style: AppTypography.bodySmall(color: AppColors.textSecondary).copyWith(
            fontSize: 12,
          ),
        ),
      ],
    );
  }
}

import 'package:flutter/material.dart';
import '../../../../core/mock/mock_dashboard_data.dart';
import '../../../../core/theme/app_colors.dart';
import 'kpi_card.dart';

class KpiCardGrid extends StatelessWidget {
  final List<KpiItemData> cards;

  const KpiCardGrid({
    super.key,
    required this.cards,
  });

  @override
  Widget build(BuildContext context) {
    // Assert exactly 5 KPI cards
    assert(cards.length == 5, 'Dashboard must have exactly 5 KPI cards');

    final List<Map<String, dynamic>> cardConfigs = [
      {
        'icon': Icons.swap_horiz_rounded,
        'iconColor': AppColors.primary,
        'iconBg': const Color(0xFFEFF4FF),
      },
      {
        'icon': Icons.arrow_downward_rounded,
        'iconColor': AppColors.success,
        'iconBg': AppColors.successBg,
      },
      {
        'icon': Icons.arrow_upward_rounded,
        'iconColor': const Color(0xFFF97316),
        'iconBg': const Color(0xFFFFF7ED),
      },
      {
        'icon': Icons.account_balance_wallet_outlined,
        'iconColor': AppColors.tertiary,
        'iconBg': const Color(0xFFF0F9FF),
      },
      {
        'icon': Icons.qr_code_2_rounded,
        'iconColor': const Color(0xFF8B5CF6),
        'iconBg': const Color(0xFFF5F3FF),
      },
    ];

    return LayoutBuilder(
      builder: (context, constraints) {
        // If wide screen, 5 columns in a single row
        if (constraints.maxWidth >= 1200) {
          return Row(
            children: List.generate(cards.length, (index) {
              return Expanded(
                child: Padding(
                  padding: EdgeInsets.only(
                    right: index == cards.length - 1 ? 0 : 16,
                  ),
                  child: KpiCard(
                    data: cards[index],
                    icon: cardConfigs[index]['icon'] as IconData,
                    iconColor: cardConfigs[index]['iconColor'] as Color,
                    iconBg: cardConfigs[index]['iconBg'] as Color,
                  ),
                ),
              );
            }),
          );
        } else {
          // Wrap for smaller screens
          final double cardWidth = (constraints.maxWidth - 32) / 3;
          return Wrap(
            spacing: 16,
            runSpacing: 16,
            children: List.generate(cards.length, (index) {
              return SizedBox(
                width: cardWidth < 220 ? constraints.maxWidth : cardWidth,
                child: KpiCard(
                  data: cards[index],
                  icon: cardConfigs[index]['icon'] as IconData,
                  iconColor: cardConfigs[index]['iconColor'] as Color,
                  iconBg: cardConfigs[index]['iconBg'] as Color,
                ),
              );
            }),
          );
        }
      },
    );
  }
}

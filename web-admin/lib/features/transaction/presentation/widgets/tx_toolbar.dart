import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_dimensions.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/widgets/app_search_input.dart';

enum TxDateFilter {
  all('Tất cả'),
  today('Hôm nay'),
  week('Tuần này'),
  month('Tháng này');

  final String label;
  const TxDateFilter(this.label);
}

class TxToolbar extends StatelessWidget {
  final ValueChanged<String> onSearchTxId;
  final TxDateFilter selectedFilter;
  final ValueChanged<TxDateFilter> onFilterChanged;
  final VoidCallback onExportExcel;

  const TxToolbar({
    super.key,
    required this.onSearchTxId,
    required this.selectedFilter,
    required this.onFilterChanged,
    required this.onExportExcel,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: AppDimensions.borderRadiusMd,
        border: Border.all(color: AppColors.border),
      ),
      child: Wrap(
        spacing: 16,
        runSpacing: 12,
        alignment: WrapAlignment.spaceBetween,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          // 1. Search TxID
          AppSearchInput(
            hintText: 'Tìm kiếm theo transaction.id (Ví dụ: TXN-20241028-98412)...',
            width: 380,
            onChanged: onSearchTxId,
          ),

          // 2. Date Filter Segment (Hôm nay | Tuần này | Tháng này) based on created_at
          Container(
            decoration: BoxDecoration(
              color: AppColors.surfaceMuted,
              borderRadius: AppDimensions.borderRadiusSm,
              border: Border.all(color: AppColors.borderStrong),
            ),
            padding: const EdgeInsets.all(3),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: TxDateFilter.values.map((filter) {
                final bool isSelected = selectedFilter == filter;
                return InkWell(
                  onTap: () => onFilterChanged(filter),
                  borderRadius: AppDimensions.borderRadiusSm,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
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
                      filter.label,
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

          // 3. Export Excel Button
          ElevatedButton.icon(
            onPressed: onExportExcel,
            icon: const Icon(Icons.file_download_outlined, size: 18),
            label: const Text('Xuất Excel'),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.primary,
              foregroundColor: Colors.white,
              elevation: 0,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              shape: RoundedRectangleBorder(
                borderRadius: AppDimensions.borderRadiusMd,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

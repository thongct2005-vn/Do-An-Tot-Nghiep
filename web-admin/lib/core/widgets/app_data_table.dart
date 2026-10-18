import 'package:flutter/material.dart';
import '../theme/app_colors.dart';
import '../theme/app_dimensions.dart';
import '../theme/app_typography.dart';

class AppTableColumn {
  final String label;
  final double? width;
  final TextAlign textAlign;
  final bool isNumeric;

  const AppTableColumn({
    required this.label,
    this.width,
    this.textAlign = TextAlign.left,
    this.isNumeric = false,
  });
}

class AppDataTable extends StatelessWidget {
  final List<AppTableColumn> columns;
  final int itemCount;
  final List<Widget> Function(BuildContext context, int index) rowBuilder;
  final void Function(int index)? onRowTap;
  final Widget? emptyState;
  final String? paginationText;
  final VoidCallback? onPreviousPage;
  final VoidCallback? onNextPage;
  final bool hasPrevious;
  final bool hasNext;

  const AppDataTable({
    super.key,
    required this.columns,
    required this.itemCount,
    required this.rowBuilder,
    this.onRowTap,
    this.emptyState,
    this.paginationText,
    this.onPreviousPage,
    this.onNextPage,
    this.hasPrevious = false,
    this.hasNext = false,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: AppDimensions.borderRadiusMd,
        border: Border.all(color: AppColors.border, width: 1),
        boxShadow: AppDimensions.cardShadow,
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final double totalColumnsWidth = columns.fold<double>(
            0.0,
            (sum, col) => sum + (col.width ?? 140.0),
          );
          final double minTableWidth = totalColumnsWidth + 32.0;
          final double availableWidth = constraints.maxWidth;
          final double effectiveTableWidth =
              availableWidth > minTableWidth ? availableWidth : minTableWidth;

          final double extraWidth = availableWidth > minTableWidth
              ? (availableWidth - minTableWidth)
              : 0.0;

          final List<double> effectiveWidths = columns.map((col) {
            final base = col.width ?? 140.0;
            if (extraWidth > 0 && totalColumnsWidth > 0) {
              return base + (extraWidth * (base / totalColumnsWidth));
            }
            return base;
          }).toList();

          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Table Body with Horizontal Scroll
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: SizedBox(
                  width: effectiveTableWidth,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Header Row
                      Container(
                        height: 44,
                        decoration: const BoxDecoration(
                          color: AppColors.surfaceMuted,
                          border: Border(
                            bottom: BorderSide(color: AppColors.border, width: 1),
                          ),
                        ),
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        child: Row(
                          children: List.generate(columns.length, (idx) {
                            final col = columns[idx];
                            final colWidth = effectiveWidths[idx];

                            return SizedBox(
                              width: colWidth,
                              child: Padding(
                                padding: const EdgeInsets.symmetric(horizontal: 10),
                                child: Align(
                                  alignment: col.textAlign == TextAlign.right
                                      ? Alignment.centerRight
                                      : col.textAlign == TextAlign.center
                                          ? Alignment.center
                                          : Alignment.centerLeft,
                                  child: Text(
                                    col.label.toUpperCase(),
                                    textAlign: col.textAlign,
                                    style: AppTypography.labelMedium(color: AppColors.textSecondary),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              ),
                            );
                          }),
                        ),
                      ),

                      // Data Rows
                      if (itemCount == 0)
                        Container(
                          width: effectiveTableWidth,
                          height: 200,
                          alignment: Alignment.center,
                          child: emptyState ??
                              Text(
                                'Không có dữ liệu phù hợp',
                                style: AppTypography.bodyMedium(color: AppColors.textMuted),
                              ),
                        )
                      else
                        ...List.generate(itemCount, (index) {
                          final cells = rowBuilder(context, index);
                          return _TableRowItem(
                            cells: cells,
                            columns: columns,
                            columnWidths: effectiveWidths,
                            rowWidth: effectiveTableWidth,
                            isLast: index == itemCount - 1,
                            onTap: onRowTap != null ? () => onRowTap!(index) : null,
                          );
                        }),
                    ],
                  ),
                ),
              ),

              // Pagination Footer (if provided)
              if (paginationText != null)
                Container(
                  height: 52,
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  decoration: const BoxDecoration(
                    border: Border(
                      top: BorderSide(color: AppColors.border, width: 1),
                    ),
                  ),
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(minWidth: 400),
                      child: Row(
                        children: [
                          Text(
                            paginationText!,
                            style: AppTypography.bodySmall(color: AppColors.textSecondary),
                          ),
                          const SizedBox(width: 32),
                          OutlinedButton.icon(
                            onPressed: hasPrevious ? onPreviousPage : null,
                            icon: const Icon(Icons.chevron_left, size: 18),
                            label: const Text('Trước'),
                            style: OutlinedButton.styleFrom(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                              side: const BorderSide(color: AppColors.border),
                              shape: RoundedRectangleBorder(
                                borderRadius: AppDimensions.borderRadiusSm,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          OutlinedButton.icon(
                            onPressed: hasNext ? onNextPage : null,
                            icon: const Icon(Icons.chevron_right, size: 18),
                            label: const Text('Sau'),
                            style: OutlinedButton.styleFrom(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                              side: const BorderSide(color: AppColors.border),
                              shape: RoundedRectangleBorder(
                                borderRadius: AppDimensions.borderRadiusSm,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

class _TableRowItem extends StatefulWidget {
  final List<Widget> cells;
  final List<AppTableColumn> columns;
  final List<double> columnWidths;
  final double rowWidth;
  final bool isLast;
  final VoidCallback? onTap;

  const _TableRowItem({
    required this.cells,
    required this.columns,
    required this.columnWidths,
    required this.rowWidth,
    required this.isLast,
    this.onTap,
  });

  @override
  State<_TableRowItem> createState() => _TableRowItemState();
}

class _TableRowItemState extends State<_TableRowItem> {
  bool _isHovered = false;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      cursor: widget.onTap != null ? SystemMouseCursors.click : SystemMouseCursors.basic,
      onEnter: (_) => setState(() => _isHovered = true),
      onExit: (_) => setState(() => _isHovered = false),
      child: GestureDetector(
        onTap: widget.onTap,
        child: Container(
          width: widget.rowWidth,
          height: 54,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          decoration: BoxDecoration(
            color: _isHovered ? AppColors.surfaceMuted : AppColors.surface,
            border: widget.isLast
                ? null
                : const Border(
                    bottom: BorderSide(color: AppColors.border, width: 1),
                  ),
          ),
          child: Row(
            children: List.generate(widget.columns.length, (colIdx) {
              final col = widget.columns[colIdx];
              final colWidth = widget.columnWidths[colIdx];
              final cell = colIdx < widget.cells.length
                  ? widget.cells[colIdx]
                  : const SizedBox();

              return SizedBox(
                width: colWidth,
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  child: Align(
                    alignment: col.textAlign == TextAlign.right
                        ? Alignment.centerRight
                        : col.textAlign == TextAlign.center
                            ? Alignment.center
                            : Alignment.centerLeft,
                    child: cell,
                  ),
                ),
              );
            }),
          ),
        ),
      ),
    );
  }
}

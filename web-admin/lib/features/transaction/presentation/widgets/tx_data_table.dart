import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/widgets/app_data_table.dart';
import '../../../../core/widgets/financial_text.dart';
import '../../../../core/widgets/status_badge.dart';
import '../../models/transaction_model.dart';

class TxDataTable extends StatelessWidget {
  final List<TransactionModel> transactions;
  final ValueChanged<TransactionModel> onTransactionSelected;

  const TxDataTable({
    super.key,
    required this.transactions,
    required this.onTransactionSelected,
  });

  @override
  Widget build(BuildContext context) {
    final columns = [
      const AppTableColumn(label: 'Mã giao dịch (TxID)', width: 190),
      const AppTableColumn(label: 'Thời gian', width: 140),
      const AppTableColumn(label: 'Loại GD', width: 150),
      const AppTableColumn(label: 'Ví nguồn', width: 190),
      const AppTableColumn(label: 'Ví đích', width: 200),
      const AppTableColumn(label: 'Số tiền', width: 160, textAlign: TextAlign.right, isNumeric: true),
      const AppTableColumn(label: 'Phí', width: 90, textAlign: TextAlign.right, isNumeric: true),
      const AppTableColumn(label: 'Trạng thái', width: 140),
      const AppTableColumn(label: '', width: 50, textAlign: TextAlign.center),
    ];

    return AppDataTable(
      columns: columns,
      itemCount: transactions.length,
      onRowTap: (index) => onTransactionSelected(transactions[index]),
      paginationText: 'Hiển thị ${transactions.length} giao dịch',
      rowBuilder: (context, index) {
        final tx = transactions[index];
        final formattedDate =
            '${tx.createdAt.hour.toString().padLeft(2, '0')}:${tx.createdAt.minute.toString().padLeft(2, '0')} ${tx.createdAt.day.toString().padLeft(2, '0')}/${tx.createdAt.month.toString().padLeft(2, '0')}';

        // Badge Status Mapping
        BadgeStatus badgeStatus;
        switch (tx.status) {
          case TransactionStatus.success:
            badgeStatus = BadgeStatus.success;
            break;
          case TransactionStatus.pending:
            badgeStatus = BadgeStatus.pending;
            break;
          case TransactionStatus.failed:
            badgeStatus = BadgeStatus.danger;
            break;
        }

        return [
          // 1. TxID (JetBrains Mono)
          Text(
            tx.id,
            style: AppTypography.monoCode(color: AppColors.primary, fontSize: 12).copyWith(
              fontWeight: FontWeight.w600,
            ),
          ),

          // 2. Created At
          Text(
            formattedDate,
            style: AppTypography.bodySmall(color: AppColors.textSecondary),
          ),

          // 3. Type
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                tx.type == TransactionType.topup
                    ? Icons.arrow_downward_rounded
                    : tx.type == TransactionType.withdraw
                        ? Icons.arrow_upward_rounded
                        : Icons.qr_code_2,
                size: 16,
                color: tx.type == TransactionType.topup
                    ? AppColors.success
                    : tx.type == TransactionType.withdraw
                        ? const Color(0xFFF97316)
                        : const Color(0xFF8B5CF6),
              ),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  tx.type.label,
                  style: AppTypography.bodySmall().copyWith(fontWeight: FontWeight.w500),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),

          // 4. Sender
          Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                tx.senderName,
                style: AppTypography.bodyMedium().copyWith(fontWeight: FontWeight.w500, fontSize: 13),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              Text(
                tx.senderPhone,
                style: AppTypography.monoCode(color: AppColors.textSecondary, fontSize: 11),
              ),
            ],
          ),

          // 5. Receiver
          Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                tx.receiverName,
                style: AppTypography.bodyMedium().copyWith(fontWeight: FontWeight.w500, fontSize: 13),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              Text(
                tx.receiverPhone,
                style: AppTypography.monoCode(color: AppColors.textSecondary, fontSize: 11),
              ),
            ],
          ),

          // 6. Amount (JetBrains Mono Right Aligned)
          FinancialText(
            amount: tx.amount,
            variant: FinancialTextVariant.cell,
            textAlign: TextAlign.right,
          ),

          // 7. Fee
          Text(
            tx.fee == 0 ? '0 ₫' : FinancialText.formatVnd(tx.fee),
            textAlign: TextAlign.right,
            style: AppTypography.monoCode(color: AppColors.textSecondary, fontSize: 12),
          ),

          // 8. Status Badge
          StatusBadge(
            label: tx.status.label,
            status: badgeStatus,
          ),

          // 9. Navigation chevron icon
          const Icon(
            Icons.chevron_right,
            size: 18,
            color: AppColors.textSecondary,
          ),
        ];
      },
    );
  }
}

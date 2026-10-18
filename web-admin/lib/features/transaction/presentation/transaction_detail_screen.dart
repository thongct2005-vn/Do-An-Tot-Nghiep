import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_dimensions.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/widgets/financial_text.dart';
import '../../../../core/widgets/status_badge.dart';
import '../models/transaction_model.dart';

class TransactionDetailScreen extends StatelessWidget {
  final TransactionModel transaction;
  final VoidCallback onBack;

  const TransactionDetailScreen({
    super.key,
    required this.transaction,
    required this.onBack,
  });

  @override
  Widget build(BuildContext context) {
    BadgeStatus badgeStatus;
    switch (transaction.status) {
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

    final formattedDate =
        '${transaction.createdAt.hour.toString().padLeft(2, '0')}:${transaction.createdAt.minute.toString().padLeft(2, '0')}:${transaction.createdAt.second.toString().padLeft(2, '0')} ngày ${transaction.createdAt.day.toString().padLeft(2, '0')}/${transaction.createdAt.month.toString().padLeft(2, '0')}/${transaction.createdAt.year}';

    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Navigation Back Button & Title
          Row(
            children: [
              OutlinedButton.icon(
                onPressed: onBack,
                icon: const Icon(Icons.arrow_back, size: 16),
                label: const Text('Danh sách giao dịch'),
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  side: const BorderSide(color: AppColors.borderStrong),
                  shape: RoundedRectangleBorder(
                    borderRadius: AppDimensions.borderRadiusSm,
                  ),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(
                          'Mã giao dịch:',
                          style: AppTypography.headlineMedium(color: AppColors.textPrimary),
                        ),
                        const SizedBox(width: 10),
                        Flexible(
                          child: Text(
                            transaction.id,
                            style: AppTypography.monoCode(color: AppColors.primary, fontSize: 16).copyWith(
                              fontWeight: FontWeight.w700,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                    Text(
                      formattedDate,
                      style: AppTypography.bodySmall(color: AppColors.textSecondary),
                    ),
                  ],
                ),
              ),
              const Spacer(),
              StatusBadge(
                label: transaction.status.label,
                status: badgeStatus,
              ),
            ],
          ),

          const SizedBox(height: 24),

          // 1. Transaction Summary Card
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: AppDimensions.borderRadiusMd,
              border: Border.all(color: AppColors.border),
              boxShadow: AppDimensions.cardShadow,
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'SỐ TIỀN GIAO DỊCH',
                      style: AppTypography.labelMedium(color: AppColors.textSecondary),
                    ),
                    const SizedBox(height: 6),
                    FinancialText(
                      amount: transaction.amount,
                      variant: FinancialTextVariant.kpi,
                      customColor: AppColors.primary,
                      textAlign: TextAlign.left,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      transaction.description,
                      style: AppTypography.bodyMedium(color: AppColors.textPrimary),
                    ),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceMuted,
                    borderRadius: AppDimensions.borderRadiusMd,
                    border: Border.all(color: AppColors.border),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      _buildReceiptRow('Phí dịch vụ:', FinancialText.formatVnd(transaction.fee)),
                      const SizedBox(height: 6),
                      _buildReceiptRow('Thuế VAT (10%):', FinancialText.formatVnd(transaction.vat)),
                      const SizedBox(height: 8),
                      const SizedBox(width: 220, child: Divider()),
                      const SizedBox(height: 8),
                      _buildReceiptRow(
                        'Tổng thực trừ:',
                        FinancialText.formatVnd(transaction.totalDeduction),
                        isTotal: true,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 24),

          // 2. Dual Columns: Details & Timeline
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Column 1: Parties & Payment Details
              Expanded(
                flex: 3,
                child: Container(
                  padding: const EdgeInsets.all(24),
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: AppDimensions.borderRadiusMd,
                    border: Border.all(color: AppColors.border),
                    boxShadow: AppDimensions.cardShadow,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'THÔNG TIN CÁC BÊN THAM GIA',
                        style: AppTypography.labelMedium(color: AppColors.textSecondary),
                      ),
                      const SizedBox(height: 16),
                      _buildPartyItem(
                        icon: Icons.person_outline,
                        role: 'Bên khởi tạo (Người chuyển / Ví nguồn):',
                        name: transaction.senderName,
                        phoneOrAccount: transaction.senderPhone,
                      ),
                      const SizedBox(height: 16),
                      const Divider(),
                      const SizedBox(height: 16),
                      _buildPartyItem(
                        icon: Icons.storefront_outlined,
                        role: 'Bên thụ hưởng (Người nhận / Đơn vị bán hàng):',
                        name: transaction.receiverName,
                        phoneOrAccount: transaction.receiverPhone,
                      ),
                      const SizedBox(height: 20),
                      Text(
                        'PHƯƠNG THỨC THANH TOÁN',
                        style: AppTypography.labelMedium(color: AppColors.textSecondary),
                      ),
                      const SizedBox(height: 8),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: AppColors.surfaceMuted,
                          borderRadius: AppDimensions.borderRadiusSm,
                          border: Border.all(color: AppColors.border),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.payment, size: 20, color: AppColors.primary),
                            const SizedBox(width: 10),
                            Text(
                              transaction.paymentMethod,
                              style: AppTypography.bodyMedium().copyWith(fontWeight: FontWeight.w600),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),

              const SizedBox(width: 24),

              // Column 2: Audit Timeline Steps
              Expanded(
                flex: 2,
                child: Container(
                  padding: const EdgeInsets.all(24),
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: AppDimensions.borderRadiusMd,
                    border: Border.all(color: AppColors.border),
                    boxShadow: AppDimensions.cardShadow,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'TIẾN TRÌNH XỬ LÝ (TIMELINE AUDIT)',
                        style: AppTypography.labelMedium(color: AppColors.textSecondary),
                      ),
                      const SizedBox(height: 16),
                      if (transaction.timeline.isEmpty)
                        Text(
                          'Giao dịch được ghi nhận trên sổ cái ngân hàng trực tiếp',
                          style: AppTypography.bodySmall(color: AppColors.textSecondary),
                        )
                      else
                        ...List.generate(transaction.timeline.length, (idx) {
                          final step = transaction.timeline[idx];
                          final isLast = idx == transaction.timeline.length - 1;
                          final stepTime =
                              '${step.timestamp.hour.toString().padLeft(2, '0')}:${step.timestamp.minute.toString().padLeft(2, '0')}:${step.timestamp.second.toString().padLeft(2, '0')}';

                          return Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Column(
                                children: [
                                  Container(
                                    width: 12,
                                    height: 12,
                                    decoration: const BoxDecoration(
                                      color: AppColors.success,
                                      shape: BoxShape.circle,
                                    ),
                                  ),
                                  if (!isLast)
                                    Container(
                                      width: 2,
                                      height: 38,
                                      color: AppColors.border,
                                    ),
                                ],
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Padding(
                                  padding: const EdgeInsets.only(bottom: 12),
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Row(
                                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                        children: [
                                          Expanded(
                                            child: Text(
                                              step.title,
                                              style: AppTypography.bodyMedium().copyWith(
                                                fontWeight: FontWeight.w600,
                                              ),
                                              maxLines: 1,
                                              overflow: TextOverflow.ellipsis,
                                            ),
                                          ),
                                          const SizedBox(width: 8),
                                          Text(
                                            stepTime,
                                            style: AppTypography.monoCode(
                                              color: AppColors.textMuted,
                                              fontSize: 10,
                                            ),
                                          ),
                                        ],
                                      ),
                                      const SizedBox(height: 2),
                                      Text(
                                        step.description,
                                        style: AppTypography.bodySmall(color: AppColors.textSecondary),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ],
                          );
                        }),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildReceiptRow(String label, String value, {bool isTotal = false}) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          label,
          style: isTotal
              ? AppTypography.bodyMedium().copyWith(fontWeight: FontWeight.w700)
              : AppTypography.bodySmall(color: AppColors.textSecondary),
        ),
        const SizedBox(width: 20),
        Text(
          value,
          style: AppTypography.monoCode(
            color: isTotal ? AppColors.textPrimary : AppColors.textSecondary,
            fontSize: isTotal ? 14 : 12,
          ).copyWith(
            fontWeight: isTotal ? FontWeight.w700 : FontWeight.w500,
          ),
        ),
      ],
    );
  }

  Widget _buildPartyItem({
    required IconData icon,
    required String role,
    required String name,
    required String phoneOrAccount,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 36,
          height: 36,
          decoration: BoxDecoration(
            color: AppColors.surfaceMuted,
            borderRadius: AppDimensions.borderRadiusSm,
          ),
          child: Icon(icon, size: 20, color: AppColors.primary),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                role,
                style: AppTypography.bodySmall(color: AppColors.textSecondary).copyWith(fontSize: 12),
              ),
              const SizedBox(height: 2),
              Text(
                name,
                style: AppTypography.titleSmall(),
              ),
              Text(
                phoneOrAccount,
                style: AppTypography.monoCode(color: AppColors.textSecondary, fontSize: 12),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

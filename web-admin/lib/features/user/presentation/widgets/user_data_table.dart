import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../core/widgets/app_data_table.dart';
import '../../../../core/widgets/financial_text.dart';
import '../../../../core/widgets/status_badge.dart';
import '../../models/user_model.dart';

class UserDataTable extends StatelessWidget {
  final List<UserModel> users;
  final ValueChanged<UserModel> onUserSelected;
  final ValueChanged<UserModel> onDeactivateTap;
  final String? paginationText;
  final VoidCallback? onPreviousPage;
  final VoidCallback? onNextPage;
  final bool hasPrevious;
  final bool hasNext;

  const UserDataTable({
    super.key,
    required this.users,
    required this.onUserSelected,
    required this.onDeactivateTap,
    this.paginationText,
    this.onPreviousPage,
    this.onNextPage,
    this.hasPrevious = false,
    this.hasNext = false,
  });

  @override
  Widget build(BuildContext context) {
    final columns = [
      const AppTableColumn(label: 'Họ tên & Định danh', width: 260),
      const AppTableColumn(label: 'Số điện thoại', width: 140),
      const AppTableColumn(label: 'Trạng thái KYC', width: 150),
      const AppTableColumn(label: 'Số dư ví', width: 160, textAlign: TextAlign.right, isNumeric: true),
      const AppTableColumn(label: 'Trạng thái', width: 160, textAlign: TextAlign.left),
      const AppTableColumn(label: 'Ngày tham gia', width: 130),
      const AppTableColumn(label: 'Thao tác', width: 80, textAlign: TextAlign.center),
    ];

    return AppDataTable(
      columns: columns,
      itemCount: users.length,
      onRowTap: (index) => onUserSelected(users[index]),
      paginationText: paginationText ?? 'Hiển thị ${users.length} người dùng',
      onPreviousPage: onPreviousPage,
      onNextPage: onNextPage,
      hasPrevious: hasPrevious,
      hasNext: hasNext,
      rowBuilder: (context, index) {
        final user = users[index];
        final formattedDate =
            '${user.createdAt.day.toString().padLeft(2, '0')}/${user.createdAt.month.toString().padLeft(2, '0')}/${user.createdAt.year}';

        return [
          // 1. Name & Email
          Row(
            children: [
              CircleAvatar(
                radius: 16,
                backgroundColor: AppColors.primaryContainer,
                child: Text(
                  user.name.isNotEmpty ? user.name[0].toUpperCase() : 'U',
                  style: const TextStyle(
                    color: AppColors.primary,
                    fontWeight: FontWeight.w700,
                    fontSize: 12,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      user.name,
                      style: AppTypography.bodyMedium().copyWith(fontWeight: FontWeight.w600),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    Text(
                      user.email,
                      style: AppTypography.bodySmall(color: AppColors.textSecondary).copyWith(fontSize: 11),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
            ],
          ),

          // 2. Phone
          Text(
            user.phone,
            style: AppTypography.monoCode(),
          ),

          // 3. KYC Status
          StatusBadge(
            label: user.kycStatus.label,
            status: user.kycStatus == KycStatus.verified
                ? BadgeStatus.success
                : user.kycStatus == KycStatus.pending
                    ? BadgeStatus.pending
                    : BadgeStatus.danger,
          ),

          // 4. Balance (Right-aligned, JetBrains Mono)
          FinancialText(
            amount: user.balance,
            variant: FinancialTextVariant.cell,
            textAlign: TextAlign.right,
          ),

          // 5. Account Status
          StatusBadge(
            label: user.status.label,
            status: user.status == UserStatus.active
                ? BadgeStatus.success
                : BadgeStatus.danger,
          ),

          // 6. Created Date
          Text(
            formattedDate,
            style: AppTypography.bodySmall(color: AppColors.textSecondary),
          ),

          // 7. Action
          IconButton(
            icon: Icon(
              user.status == UserStatus.active ? Icons.lock_outline : Icons.lock_open,
              size: 18,
              color: user.status == UserStatus.active ? AppColors.danger : AppColors.success,
            ),
            tooltip: user.status == UserStatus.active ? 'Vô hiệu hóa tài khoản' : 'Mở khóa tài khoản',
            onPressed: () => onDeactivateTap(user),
          ),
        ];
      },
    );
  }
}

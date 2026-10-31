import 'package:flutter/material.dart';
import '../../../core/mock/mock_transactions_data.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../models/transaction_model.dart';
import 'widgets/tx_data_table.dart';
import 'widgets/tx_toolbar.dart';

class TransactionListScreen extends StatefulWidget {
  final ValueChanged<TransactionModel> onOpenDetail;

  const TransactionListScreen({
    super.key,
    required this.onOpenDetail,
  });

  @override
  State<TransactionListScreen> createState() => _TransactionListScreenState();
}

class _TransactionListScreenState extends State<TransactionListScreen> {
  late final List<TransactionModel> _allTransactions;
  String _searchTxId = '';
  TxDateFilter _selectedDateFilter = TxDateFilter.all;

  @override
  void initState() {
    super.initState();
    _allTransactions = MockTransactionsData.getTransactions();
  }

  List<TransactionModel> get _filteredTransactions {
    final now = DateTime.now();

    return _allTransactions.where((tx) {
      // 1. Search by transaction.id
      if (_searchTxId.trim().isNotEmpty) {
        final query = _searchTxId.trim().toLowerCase();
        if (!tx.id.toLowerCase().contains(query)) {
          return false;
        }
      }

      // 2. Filter by date/week/month based on created_at
      switch (_selectedDateFilter) {
        case TxDateFilter.all:
          return true;
        case TxDateFilter.today:
          return tx.createdAt.year == now.year &&
              tx.createdAt.month == now.month &&
              tx.createdAt.day == now.day;
        case TxDateFilter.week:
          final difference = now.difference(tx.createdAt).inDays;
          return difference <= 7;
        case TxDateFilter.month:
          final difference = now.difference(tx.createdAt).inDays;
          return difference <= 30;
      }
    }).toList();
  }

  void _handleExportExcel() {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            const Icon(Icons.check_circle_outline, color: Colors.white, size: 20),
            const SizedBox(width: 10),
            Text('Đã xuất thành công ${_filteredTransactions.length} bản ghi giao dịch ra file Excel.'),
          ],
        ),
        backgroundColor: AppColors.success,
        behavior: SnackBarBehavior.floating,
        width: 480,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // Note: STRICTLY NO KPI OR CHARTS IN THIS SCREEN
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
                      'Sổ Cái Giao Dịch Tài Chính',
                      style: AppTypography.headlineMedium(color: AppColors.textPrimary),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Tra cứu lịch sử nạp, rút, thanh toán QR, đối soát số liệu và xuất báo cáo',
                      style: AppTypography.bodySmall(color: AppColors.textSecondary),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 16),
              Text(
                'Tổng: ${_filteredTransactions.length} giao dịch',
                style: AppTypography.bodySmall(color: AppColors.textSecondary),
              ),
            ],
          ),

          const SizedBox(height: 20),

          // 1. Toolbar: Search by ID + Filter by Date + Export Excel
          TxToolbar(
            selectedFilter: _selectedDateFilter,
            onSearchTxId: (query) {
              setState(() {
                _searchTxId = query;
              });
            },
            onFilterChanged: (filter) {
              setState(() {
                _selectedDateFilter = filter;
              });
            },
            onExportExcel: _handleExportExcel,
          ),

          const SizedBox(height: 20),

          // 2. Enterprise Transaction Data Table
          TxDataTable(
            transactions: _filteredTransactions,
            onTransactionSelected: widget.onOpenDetail,
          ),
        ],
      ),
    );
  }
}

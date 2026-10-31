class KpiItemData {
  final String title;
  final num value;
  final bool isCurrency;
  final double changePercentage;
  final bool isPositive;
  final String formulaDescription;

  const KpiItemData({
    required this.title,
    required this.value,
    this.isCurrency = true,
    required this.changePercentage,
    required this.isPositive,
    required this.formulaDescription,
  });
}

class ChartPointData {
  final String timeLabel;
  final num topupAmount;
  final num withdrawAmount;
  final num qrPaymentAmount;
  final num netAmount;

  const ChartPointData({
    required this.timeLabel,
    required this.topupAmount,
    required this.withdrawAmount,
    required this.qrPaymentAmount,
    required this.netAmount,
  });
}

class MockDashboardData {
  // Exactly 5 KPI Cards according to specs and Stitch project
  static const List<KpiItemData> kpiCards = [
    KpiItemData(
      title: 'Tổng số giao dịch',
      value: 1482950,
      isCurrency: false,
      changePercentage: 12.4,
      isPositive: true,
      formulaDescription: 'COUNT(id)',
    ),
    KpiItemData(
      title: 'Tổng tiền nạp',
      value: 48650000000,
      isCurrency: true,
      changePercentage: 8.2,
      isPositive: true,
      formulaDescription: 'TOPUP, SUCCESS',
    ),
    KpiItemData(
      title: 'Tổng tiền rút',
      value: 31280000000,
      isCurrency: true,
      changePercentage: -2.5,
      isPositive: false,
      formulaDescription: 'WITHDRAW, SUCCESS',
    ),
    KpiItemData(
      title: 'Dòng tiền ròng',
      value: 17370000000, // 48.650.000.000 - 31.280.000.000
      isCurrency: true,
      changePercentage: 15.8,
      isPositive: true,
      formulaDescription: 'Nạp thành công - Rút thành công',
    ),
    KpiItemData(
      title: 'Tổng tiền thanh toán QR',
      value: 14920000000,
      isCurrency: true,
      changePercentage: 19.1,
      isPositive: true,
      formulaDescription: 'PAYMENT, SUCCESS',
    ),
  ];

  // Chart data for 7 days
  static const List<ChartPointData> weekChartData = [
    ChartPointData(
      timeLabel: 'Thứ 2',
      topupAmount: 6500000000,
      withdrawAmount: 4200000000,
      qrPaymentAmount: 1800000000,
      netAmount: 2300000000,
    ),
    ChartPointData(
      timeLabel: 'Thứ 3',
      topupAmount: 7200000000,
      withdrawAmount: 4800000000,
      qrPaymentAmount: 2100000000,
      netAmount: 2400000000,
    ),
    ChartPointData(
      timeLabel: 'Thứ 4',
      topupAmount: 5800000000,
      withdrawAmount: 3900000000,
      qrPaymentAmount: 1900000000,
      netAmount: 1900000000,
    ),
    ChartPointData(
      timeLabel: 'Thứ 5',
      topupAmount: 8100000000,
      withdrawAmount: 5100000000,
      qrPaymentAmount: 2400000000,
      netAmount: 3000000000,
    ),
    ChartPointData(
      timeLabel: 'Thứ 6',
      topupAmount: 9400000000,
      withdrawAmount: 5800000000,
      qrPaymentAmount: 2900000000,
      netAmount: 3600000000,
    ),
    ChartPointData(
      timeLabel: 'Thứ 7',
      topupAmount: 6200000000,
      withdrawAmount: 4100000000,
      qrPaymentAmount: 2200000000,
      netAmount: 2100000000,
    ),
    ChartPointData(
      timeLabel: 'Chủ nhật',
      topupAmount: 5450000000,
      withdrawAmount: 3380000000,
      qrPaymentAmount: 1620000000,
      netAmount: 2070000000,
    ),
  ];

  // Chart data for Today (by hours)
  static const List<ChartPointData> todayChartData = [
    ChartPointData(
      timeLabel: '06:00',
      topupAmount: 450000000,
      withdrawAmount: 210000000,
      qrPaymentAmount: 120000000,
      netAmount: 240000000,
    ),
    ChartPointData(
      timeLabel: '09:00',
      topupAmount: 1200000000,
      withdrawAmount: 780000000,
      qrPaymentAmount: 340000000,
      netAmount: 420000000,
    ),
    ChartPointData(
      timeLabel: '12:00',
      topupAmount: 1850000000,
      withdrawAmount: 920000000,
      qrPaymentAmount: 650000000,
      netAmount: 930000000,
    ),
    ChartPointData(
      timeLabel: '15:00',
      topupAmount: 1400000000,
      withdrawAmount: 890000000,
      qrPaymentAmount: 480000000,
      netAmount: 510000000,
    ),
    ChartPointData(
      timeLabel: '18:00',
      topupAmount: 2100000000,
      withdrawAmount: 1100000000,
      qrPaymentAmount: 820000000,
      netAmount: 1000000000,
    ),
    ChartPointData(
      timeLabel: '21:00',
      topupAmount: 950000000,
      withdrawAmount: 450000000,
      qrPaymentAmount: 390000000,
      netAmount: 500000000,
    ),
  ];

  // Chart data for Month (by week)
  static const List<ChartPointData> monthChartData = [
    ChartPointData(
      timeLabel: 'Tuần 1',
      topupAmount: 11200000000,
      withdrawAmount: 7500000000,
      qrPaymentAmount: 3400000000,
      netAmount: 3700000000,
    ),
    ChartPointData(
      timeLabel: 'Tuần 2',
      topupAmount: 12800000000,
      withdrawAmount: 8100000000,
      qrPaymentAmount: 3900000000,
      netAmount: 4700000000,
    ),
    ChartPointData(
      timeLabel: 'Tuần 3',
      topupAmount: 13100000000,
      withdrawAmount: 8400000000,
      qrPaymentAmount: 4100000000,
      netAmount: 4700000000,
    ),
    ChartPointData(
      timeLabel: 'Tuần 4',
      topupAmount: 11550000000,
      withdrawAmount: 7280000000,
      qrPaymentAmount: 3520000000,
      netAmount: 4270000000,
    ),
  ];
}

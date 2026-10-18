import 'package:flutter/material.dart';
import 'core/theme/app_theme.dart';
import 'core/widgets/app_shell.dart';
import 'core/widgets/sidebar.dart';
import 'features/auth/models/admin_session_model.dart';
import 'features/auth/presentation/login_screen.dart';
import 'features/dashboard/presentation/dashboard_screen.dart';
import 'features/transaction/models/transaction_model.dart';
import 'features/transaction/presentation/transaction_detail_screen.dart';
import 'features/transaction/presentation/transaction_list_screen.dart';
import 'features/user/data/user_api_service.dart';
import 'features/user/models/user_model.dart';
import 'features/user/presentation/user_list_screen.dart';

class WebAdminApp extends StatefulWidget {
  final bool initialAuthenticated;
  final AdminSessionModel? initialSession;
  final UserApiService? userApiService;
  final List<UserModel>? initialUsers;

  const WebAdminApp({
    super.key,
    this.initialAuthenticated = false,
    this.initialSession,
    this.userApiService,
    this.initialUsers,
  });

  @override
  State<WebAdminApp> createState() => _WebAdminAppState();
}

class _WebAdminAppState extends State<WebAdminApp> {
  late bool _isAuthenticated;
  late AdminSessionModel? _adminSession;
  AdminNavItem _currentItem = AdminNavItem.dashboard;
  TransactionModel? _selectedTransaction;

  @override
  void initState() {
    super.initState();
    _isAuthenticated = widget.initialAuthenticated;
    _adminSession = widget.initialSession;
    if (widget.initialSession?.accessToken != null) {
      UserApiService.defaultToken = widget.initialSession!.accessToken;
    }
  }

  void _navigateToItem(AdminNavItem item) {
    setState(() {
      _currentItem = item;
      _selectedTransaction = null; // reset detail view when switching tabs
    });
  }

  String get _currentTitle {
    if (_selectedTransaction != null) {
      return 'Chi tiết giao dịch';
    }
    switch (_currentItem) {
      case AdminNavItem.dashboard:
        return 'Tổng quan Dashboard';
      case AdminNavItem.users:
        return 'Quản lý người dùng';
      case AdminNavItem.transactions:
        return 'Quản lý giao dịch';
    }
  }

  String? get _currentSubtitle {
    if (_selectedTransaction != null) {
      return 'Mã TxID: ${_selectedTransaction!.id}';
    }
    switch (_currentItem) {
      case AdminNavItem.dashboard:
        return 'Báo cáo tài chính & chỉ số dòng tiền ví điện tử';
      case AdminNavItem.users:
        return 'Danh sách tài khoản, số dư khả dụng và hồ sơ KYC';
      case AdminNavItem.transactions:
        return 'Nhật ký đối soát dòng tiền và lịch sử giao dịch';
    }
  }

  Widget _buildBody() {
    if (_selectedTransaction != null) {
      return TransactionDetailScreen(
        transaction: _selectedTransaction!,
        onBack: () {
          setState(() {
            _selectedTransaction = null;
          });
        },
      );
    }

    switch (_currentItem) {
      case AdminNavItem.dashboard:
        return const DashboardScreen();
      case AdminNavItem.users:
        return UserListScreen(
          token: _adminSession?.accessToken,
          apiService: widget.userApiService,
          initialUsers: widget.initialUsers,
        );
      case AdminNavItem.transactions:
        return TransactionListScreen(
          onOpenDetail: (tx) {
            setState(() {
              _selectedTransaction = tx;
            });
          },
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'E-Wallet Web Admin',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      home: _isAuthenticated
          ? AdminShell(
              currentItem: _currentItem,
              onItemSelected: _navigateToItem,
              title: _currentTitle,
              subtitle: _currentSubtitle,
              adminName: _adminSession?.adminInfo.fullName,
              adminEmail: _adminSession?.adminInfo.email,
              onLogout: () {
                UserApiService.defaultToken = null;
                setState(() {
                  _adminSession = null;
                  _isAuthenticated = false;
                  _currentItem = AdminNavItem.dashboard;
                  _selectedTransaction = null;
                });
              },
              child: _buildBody(),
            )
          : LoginScreen(
              onLoginSuccess: (session) {
                UserApiService.defaultToken = session.accessToken;
                setState(() {
                  _adminSession = session;
                  _isAuthenticated = true;
                  _currentItem = AdminNavItem.dashboard;
                  _selectedTransaction = null;
                });
              },
            ),
    );
  }
}

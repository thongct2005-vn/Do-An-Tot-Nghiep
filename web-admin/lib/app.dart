import 'package:flutter/material.dart';
import 'core/theme/app_theme.dart';
import 'core/widgets/app_shell.dart';
import 'core/widgets/sidebar.dart';
import 'features/auth/data/auth_api_service.dart';
import 'features/auth/data/auth_storage_service.dart';
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
  final AuthStorageService? authStorageService;
  final AuthApiService? authApiService;

  const WebAdminApp({
    super.key,
    this.initialAuthenticated = false,
    this.initialSession,
    this.userApiService,
    this.initialUsers,
    this.authStorageService,
    this.authApiService,
  });

  @override
  State<WebAdminApp> createState() => _WebAdminAppState();
}

class _WebAdminAppState extends State<WebAdminApp> {
  late bool _isAuthenticated;
  late bool _isCheckingAuth;
  late AdminSessionModel? _adminSession;
  late final AuthStorageService _authStorage;
  late final AuthApiService _authApiService;
  AdminNavItem _currentItem = AdminNavItem.dashboard;
  TransactionModel? _selectedTransaction;

  @override
  void initState() {
    super.initState();
    _authStorage = widget.authStorageService ?? AuthStorageService();
    _authApiService = widget.authApiService ?? AuthApiService();
    _isAuthenticated = widget.initialAuthenticated;
    _adminSession = widget.initialSession;
    if (widget.initialSession?.accessToken != null) {
      UserApiService.defaultToken = widget.initialSession!.accessToken;
    }

    if (_isAuthenticated) {
      _isCheckingAuth = false;
    } else {
      _isCheckingAuth = true;
      _checkExistingSession();
    }
  }

  /// Tự động kiểm tra và khôi phục phiên đăng nhập khi F5 hoặc khởi động
  Future<void> _checkExistingSession() async {
    try {
      final session = await _authStorage.getSession();
      if (session == null || session.accessToken.isEmpty) {
        if (mounted) {
          setState(() {
            _isCheckingAuth = false;
            _isAuthenticated = false;
          });
        }
        return;
      }

      // 1. Thử xác thực với getMe(accessToken)
      try {
        final me = await _authApiService.getMe(accessToken: session.accessToken);
        final updatedSession = session.copyWith(adminInfo: me);
        await _authStorage.saveSession(updatedSession);
        UserApiService.defaultToken = updatedSession.accessToken;

        if (mounted) {
          setState(() {
            _adminSession = updatedSession;
            _isAuthenticated = true;
            _isCheckingAuth = false;
          });
        }
        return;
      } on AuthApiException catch (e) {
        // Nếu lỗi 401 hoặc token hết hạn, thử refresh token
        if (e.statusCode == 401 && session.refreshToken.isNotEmpty) {
          try {
            final tokens = await _authApiService.refreshToken(
              refreshToken: session.refreshToken,
            );
            final newAccessToken = tokens['access_token'] ?? '';
            final newRefreshToken = tokens['refresh_token'] ?? '';

            if (newAccessToken.isNotEmpty) {
              final me = await _authApiService.getMe(accessToken: newAccessToken);
              final refreshedSession = session.copyWith(
                accessToken: newAccessToken,
                refreshToken: newRefreshToken.isNotEmpty
                    ? newRefreshToken
                    : session.refreshToken,
                adminInfo: me,
              );
              await _authStorage.saveSession(refreshedSession);
              UserApiService.defaultToken = refreshedSession.accessToken;

              if (mounted) {
                setState(() {
                  _adminSession = refreshedSession;
                  _isAuthenticated = true;
                  _isCheckingAuth = false;
                });
              }
              return;
            }
          } catch (_) {
            // Gia hạn token thất bại
          }
        }
      } catch (_) {
        // Bắt các ngoại lệ khác khi gọi getMe
      }

      // Nếu xác thực thất bại hoặc refresh token thất bại, dọn sạch bộ nhớ
      await _authStorage.clearSession();
      UserApiService.defaultToken = null;
      if (mounted) {
        setState(() {
          _adminSession = null;
          _isAuthenticated = false;
          _isCheckingAuth = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _isCheckingAuth = false;
          _isAuthenticated = false;
        });
      }
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
      home: _isCheckingAuth
          ? const Scaffold(
              body: Center(
                child: CircularProgressIndicator(),
              ),
            )
          : _isAuthenticated
              ? AdminShell(
                  currentItem: _currentItem,
                  onItemSelected: _navigateToItem,
                  title: _currentTitle,
                  subtitle: _currentSubtitle,
                  adminName: _adminSession?.adminInfo.fullName,
                  adminEmail: _adminSession?.adminInfo.email,
                  onLogout: () async {
                    final currentToken = _adminSession?.accessToken;
                    if (currentToken != null && currentToken.isNotEmpty) {
                      _authApiService.logout(accessToken: currentToken);
                    }
                    await _authStorage.clearSession();
                    UserApiService.defaultToken = null;
                    if (mounted) {
                      setState(() {
                        _adminSession = null;
                        _isAuthenticated = false;
                        _currentItem = AdminNavItem.dashboard;
                        _selectedTransaction = null;
                      });
                    }
                  },
                  child: _buildBody(),
                )
              : LoginScreen(
                  onLoginSuccess: (session) async {
                    UserApiService.defaultToken = session.accessToken;
                    await _authStorage.saveSession(session);
                    if (mounted) {
                      setState(() {
                        _adminSession = session;
                        _isAuthenticated = true;
                        _currentItem = AdminNavItem.dashboard;
                        _selectedTransaction = null;
                      });
                    }
                  },
                ),
    );
  }
}

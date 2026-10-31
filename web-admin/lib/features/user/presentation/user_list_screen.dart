import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_dimensions.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_search_input.dart';
import '../data/user_api_service.dart';
import '../models/user_model.dart';
import 'widgets/deactivate_dialog.dart';
import 'widgets/edit_user_profile_dialog.dart';
import 'widgets/user_data_table.dart';
import 'widgets/user_detail_drawer.dart';

class UserListScreen extends StatefulWidget {
  final String? token;
  final UserApiService? apiService;
  final List<UserModel>? initialUsers;

  const UserListScreen({
    super.key,
    this.token,
    this.apiService,
    this.initialUsers,
  });

  @override
  State<UserListScreen> createState() => _UserListScreenState();
}

class _UserListScreenState extends State<UserListScreen> {
  late final UserApiService _apiService;
  List<UserModel> _users = [];
  UserStats? _stats;
  bool _isLoading = true;
  String? _errorMessage;

  String _searchQuery = '';
  String _selectedStatus = 'ALL';
  int _currentPage = 1;
  int _totalPages = 1;
  int _totalItems = 0;
  final int _limit = 10;

  UserModel? _selectedUser;
  int _transactionRefreshTick = 0;
  Timer? _debounceTimer;

  @override
  void initState() {
    super.initState();
    _apiService = widget.apiService ??
        UserApiService(token: widget.token ?? UserApiService.defaultToken);

    if (widget.initialUsers != null) {
      _users = List.from(widget.initialUsers!);
      _totalItems = _users.length;
      _totalPages = (_users.length / _limit).ceil().clamp(1, 9999);
      _stats = UserStats(
        totalUsers: _users.length,
        activeUsers: _users.where((u) => u.status == UserStatus.active).length,
        suspendedUsers:
            _users.where((u) => u.status == UserStatus.suspended).length,
      );
      _isLoading = false;
    } else {
      _loadData();
    }
  }

  @override
  void dispose() {
    _debounceTimer?.cancel();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final statsFuture = _apiService.getStats();
      final usersFuture = _apiService.getUsers(
        page: _currentPage,
        limit: _limit,
        search: _searchQuery.trim().isEmpty ? null : _searchQuery.trim(),
        status: _selectedStatus == 'ALL' ? null : _selectedStatus,
      );

      final results = await Future.wait([statsFuture, usersFuture]);
      if (!mounted) return;

      final stats = results[0] as UserStats;
      final paginated = results[1] as UserPaginatedResult;

      setState(() {
        _stats = stats;
        _users = paginated.items;
        _totalItems = paginated.totalItems;
        _totalPages = paginated.totalPages;
        _currentPage = paginated.currentPage;
        _isLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _errorMessage = e.toString();
        _isLoading = false;
      });
    }
  }

  void _onSearchChanged(String val) {
    _debounceTimer?.cancel();
    _debounceTimer = Timer(const Duration(milliseconds: 350), () {
      if (!mounted) return;
      setState(() {
        _searchQuery = val;
        _currentPage = 1;
      });
      _loadData();
    });
  }

  void _toggleStatusFilter(String targetStatus) {
    setState(() {
      if (_selectedStatus == targetStatus) {
        _selectedStatus = 'ALL';
      } else {
        _selectedStatus = targetStatus;
      }
      _currentPage = 1;
    });
    _loadData();
  }

  Future<void> _handleUserSelected(UserModel user) async {
    setState(() {
      _selectedUser = user;
    });

    try {
      final detailedUser = await _apiService.getUserDetail(user.id);
      if (mounted && _selectedUser?.id == user.id) {
        setState(() {
          _selectedUser = detailedUser;
        });
      }
    } catch (_) {
      // Giữ nguyên thông tin cơ bản nếu API chi tiết có lỗi
    }
  }

  void _handleDeactivate(UserModel user) {
    DeactivateUserDialog.show(
      context,
      user: user,
      onDeactivate: (reason) async {
        final isActivating = user.status == UserStatus.suspended;
        final targetStatus = isActivating ? 'ACTIVE' : 'BLOCKED';

        try {
          await _apiService.updateUserStatus(
            id: user.id,
            status: targetStatus,
            reason: reason,
          );
          if (!mounted) return;

          final updatedStatus =
              isActivating ? UserStatus.active : UserStatus.suspended;
          final updatedUser = user.copyWith(
            status: updatedStatus,
            suspensionReason: isActivating ? null : reason,
          );

          setState(() {
            final idx = _users.indexWhere((u) => u.id == user.id);
            if (idx != -1) {
              _users[idx] = updatedUser;
            }
            if (_selectedUser?.id == user.id) {
              _selectedUser = updatedUser;
            }
            if (_stats != null) {
              final activeDiff = isActivating ? 1 : -1;
              final suspendedDiff = isActivating ? -1 : 1;
              _stats = UserStats(
                totalUsers: _stats!.totalUsers,
                activeUsers: (_stats!.activeUsers + activeDiff)
                    .clamp(0, _stats!.totalUsers),
                suspendedUsers: (_stats!.suspendedUsers + suspendedDiff)
                    .clamp(0, _stats!.totalUsers),
              );
            }
          });

          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                isActivating
                    ? 'Đã mở khóa tài khoản ${user.name} thành công'
                    : 'Đã vô hiệu hóa tài khoản ${user.name} thành công',
              ),
              backgroundColor:
                  isActivating ? AppColors.success : AppColors.danger,
              behavior: SnackBarBehavior.floating,
              width: 400,
            ),
          );
        } catch (e) {
          if (!mounted) return;
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Lỗi: ${e.toString()}'),
              backgroundColor: AppColors.danger,
              behavior: SnackBarBehavior.floating,
              width: 400,
            ),
          );
        }
      },
    );
  }

  void _handleEditProfile(UserModel user) {
    EditUserProfileDialog.show(
      context,
      user: user,
      onSave: ({
        required String? fullName,
        required String? phone,
        required String? email,
        required String reason,
      }) async {
        final updatedUser = await _apiService.updateUserProfile(
          id: user.id,
          fullName: fullName,
          phone: phone,
          email: email,
          reason: reason,
        );

        if (!mounted) return;

        setState(() {
          final idx = _users.indexWhere((u) => u.id == user.id);
          if (idx != -1) {
            _users[idx] = updatedUser;
          }
          if (_selectedUser?.id == user.id) {
            _selectedUser = updatedUser;
          }
        });

        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Đã cập nhật thông tin người dùng ${updatedUser.name} thành công',
            ),
            backgroundColor: AppColors.success,
            behavior: SnackBarBehavior.floating,
            width: 400,
          ),
        );
      },
    );
  }

  Future<void> _handleP2PTransferSuccess(AdminP2PTransferResult result) async {
    if (!mounted) return;

    final formatter = NumberFormat('#,###', 'vi_VN');
    final formattedAmount = formatter.format(result.amount.abs());

    setState(() {
      _transactionRefreshTick++;

      // Cập nhật nhanh số dư người gửi và người nhận nếu đang hiển thị trên bảng
      final srcIdx = _users.indexWhere((u) => u.id == result.sourceUserId);
      if (srcIdx != -1) {
        final srcUser = _users[srcIdx];
        _users[srcIdx] = srcUser.copyWith(
          balance: result.sourceBalanceAfter,
          dailyUsed: srcUser.dailyUsed + result.amount + result.fee,
        );
      }

      final destIdx =
          _users.indexWhere((u) => u.id == result.destinationUserId);
      if (destIdx != -1 && !result.replayed) {
        final destUser = _users[destIdx];
        _users[destIdx] = destUser.copyWith(
          balance: destUser.balance + result.amount,
        );
      }

      if (_selectedUser?.id == result.sourceUserId) {
        _selectedUser = _selectedUser!.copyWith(
          balance: result.sourceBalanceAfter,
          dailyUsed: _selectedUser!.dailyUsed + result.amount + result.fee,
        );
      }
    });

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          '${result.message}: Đã chuyển $formattedAmount đ tới ${result.destinationUserName} (Mã GD: #${result.transactionId})',
        ),
        backgroundColor: AppColors.success,
        behavior: SnackBarBehavior.floating,
        width: 480,
      ),
    );

    // Làm mới đồng bộ dữ liệu danh sách và hồ sơ chi tiết từ máy chủ
    await _loadData();
    if (!mounted) return;
    if (_selectedUser != null) {
      final currentSelectedId = _selectedUser!.id;
      try {
        final refreshedDetail =
            await _apiService.getUserDetail(currentSelectedId);
        if (mounted && _selectedUser?.id == currentSelectedId) {
          setState(() {
            _selectedUser = refreshedDetail;
            _transactionRefreshTick++;
          });
        }
      } catch (_) {}
    }
  }

  @override
  Widget build(BuildContext context) {
    final activeCount = _stats?.activeUsers ??
        _users.where((u) => u.status == UserStatus.active).length;
    final suspendedCount = _stats?.suspendedUsers ??
        _users.where((u) => u.status == UserStatus.suspended).length;

    return Stack(
      children: [
        // Main Screen Content
        SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Screen Header
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Danh sách Người dùng & Hồ sơ Ví',
                          style: AppTypography.headlineMedium(
                              color: AppColors.textPrimary),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Tra cứu tài khoản, số dư khả dụng, định danh KYC và quản lý trạng thái ví',
                          style: AppTypography.bodySmall(
                              color: AppColors.textSecondary),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 16),
                  Row(
                    children: [
                      _buildCountBadge(
                        'Đang hoạt động',
                        activeCount,
                        AppColors.success,
                        isSelected: _selectedStatus == 'ACTIVE',
                        onTap: () => _toggleStatusFilter('ACTIVE'),
                      ),
                      const SizedBox(width: 8),
                      _buildCountBadge(
                        'Đã khóa',
                        suspendedCount,
                        AppColors.danger,
                        isSelected: _selectedStatus == 'BLOCKED',
                        onTap: () => _toggleStatusFilter('BLOCKED'),
                      ),
                    ],
                  ),
                ],
              ),

              const SizedBox(height: 20),

              // Toolbar: Search Input
              Row(
                children: [
                  AppSearchInput(
                    hintText: 'Tìm theo họ tên, số điện thoại ví...',
                    width: 380,
                    onChanged: _onSearchChanged,
                  ),
                  const Spacer(),
                  if (_isLoading)
                    const Padding(
                      padding: EdgeInsets.symmetric(horizontal: 16),
                      child: SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    ),
                  Text(
                    'Tổng: $_totalItems tài khoản',
                    style:
                        AppTypography.bodySmall(color: AppColors.textSecondary),
                  ),
                ],
              ),

              const SizedBox(height: 16),

              // Error banner if any
              if (_errorMessage != null && _users.isEmpty)
                Container(
                  padding: const EdgeInsets.all(16),
                  margin: const EdgeInsets.only(bottom: 16),
                  decoration: BoxDecoration(
                    color: AppColors.dangerBg,
                    borderRadius: AppDimensions.borderRadiusMd,
                    border: Border.all(color: AppColors.dangerBorder),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.error_outline,
                          color: AppColors.danger, size: 24),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          _errorMessage!,
                          style: AppTypography.bodyMedium(
                              color: AppColors.dangerText),
                        ),
                      ),
                      OutlinedButton(
                        onPressed: _loadData,
                        style: OutlinedButton.styleFrom(
                          side: const BorderSide(color: AppColors.danger),
                          foregroundColor: AppColors.danger,
                        ),
                        child: const Text('Thử lại'),
                      ),
                    ],
                  ),
                ),

              // User Data Table
              UserDataTable(
                users: _users,
                onUserSelected: _handleUserSelected,
                onDeactivateTap: _handleDeactivate,
                paginationText:
                    'Hiển thị ${_users.length} / $_totalItems người dùng (Trang $_currentPage/$_totalPages)',
                hasPrevious: _currentPage > 1,
                hasNext: _currentPage < _totalPages,
                onPreviousPage: () {
                  if (_currentPage > 1) {
                    setState(() => _currentPage--);
                    _loadData();
                  }
                },
                onNextPage: () {
                  if (_currentPage < _totalPages) {
                    setState(() => _currentPage++);
                    _loadData();
                  }
                },
              ),
            ],
          ),
        ),

        // Slide-over Details Drawer
        if (_selectedUser != null) ...[
          // Backdrop
          Positioned.fill(
            child: GestureDetector(
              onTap: () {
                setState(() {
                  _selectedUser = null;
                });
              },
              child: Container(
                color: const Color(0x330F172A),
              ),
            ),
          ),

          // Drawer
          Positioned(
            top: 0,
            bottom: 0,
            right: 0,
            child: UserDetailDrawer(
              user: _selectedUser!,
              apiService: _apiService,
              transactionRefreshTick: _transactionRefreshTick,
              onP2PTransferSuccess: _handleP2PTransferSuccess,
              onClose: () {
                setState(() {
                  _selectedUser = null;
                });
              },
              onDeactivateTap: () => _handleDeactivate(_selectedUser!),
              onEditTap: () => _handleEditProfile(_selectedUser!),
            ),
          ),
        ],
      ],
    );
  }

  Widget _buildCountBadge(
    String label,
    int count,
    Color color, {
    bool isSelected = false,
    VoidCallback? onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: AppDimensions.borderRadiusSm,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: isSelected ? color.withAlpha(30) : AppColors.surface,
          borderRadius: AppDimensions.borderRadiusSm,
          border: Border.all(
            color: isSelected ? color : AppColors.border,
            width: isSelected ? 1.5 : 1,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(color: color, shape: BoxShape.circle),
            ),
            const SizedBox(width: 6),
            Text(
              '$label: $count',
              style: AppTypography.labelMedium(
                color: isSelected ? color : AppColors.textPrimary,
              ).copyWith(fontSize: 11, fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500),
            ),
          ],
        ),
      ),
    );
  }
}

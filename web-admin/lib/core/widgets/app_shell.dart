import 'package:flutter/material.dart';
import '../theme/app_colors.dart';
import '../theme/app_dimensions.dart';
import 'sidebar.dart';
import 'topbar.dart';

class AdminShell extends StatelessWidget {
  final AdminNavItem currentItem;
  final ValueChanged<AdminNavItem> onItemSelected;
  final String title;
  final String? subtitle;
  final Widget child;
  final String? adminName;
  final String? adminEmail;
  final VoidCallback? onLogout;

  const AdminShell({
    super.key,
    required this.currentItem,
    required this.onItemSelected,
    required this.title,
    this.subtitle,
    required this.child,
    this.adminName,
    this.adminEmail,
    this.onLogout,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: Row(
        children: [
          // Fixed Left Sidebar (260px)
          Sidebar(
            currentItem: currentItem,
            onItemSelected: onItemSelected,
          ),

          // Fluid Main Content Area
          Expanded(
            child: Column(
              children: [
                // Fixed Topbar (64px)
                Topbar(
                  title: title,
                  subtitle: subtitle,
                  adminName: adminName,
                  adminEmail: adminEmail,
                  onLogout: onLogout,
                ),

                // Canvas Body with standard padding
                Expanded(
                  child: Container(
                    color: AppColors.background,
                    padding: const EdgeInsets.all(AppDimensions.paddingCanvas),
                    child: child,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

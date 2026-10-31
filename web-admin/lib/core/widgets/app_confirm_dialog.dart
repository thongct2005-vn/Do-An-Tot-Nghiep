import 'package:flutter/material.dart';
import '../theme/app_colors.dart';
import '../theme/app_dimensions.dart';
import '../theme/app_typography.dart';

class AppConfirmDialog extends StatefulWidget {
  final String title;
  final String message;
  final String confirmLabel;
  final String cancelLabel;
  final bool isDestructive;
  final bool requireReason;
  final String reasonHint;
  final void Function(String reason)? onConfirmWithReason;
  final VoidCallback? onConfirm;

  const AppConfirmDialog({
    super.key,
    required this.title,
    required this.message,
    this.confirmLabel = 'Xác nhận',
    this.cancelLabel = 'Hủy bỏ',
    this.isDestructive = true,
    this.requireReason = false,
    this.reasonHint = 'Nhập lý do thực hiện thao tác này (bắt buộc)...',
    this.onConfirmWithReason,
    this.onConfirm,
  });

  static Future<bool?> show(
    BuildContext context, {
    required String title,
    required String message,
    String confirmLabel = 'Xác nhận',
    bool isDestructive = true,
    bool requireReason = false,
    String reasonHint = 'Nhập lý do thực hiện thao tác này (bắt buộc)...',
    void Function(String reason)? onConfirmWithReason,
  }) {
    return showDialog<bool>(
      context: context,
      barrierDismissible: false,
      barrierColor: const Color(0x7F0F172A),
      builder: (ctx) => AppConfirmDialog(
        title: title,
        message: message,
        confirmLabel: confirmLabel,
        isDestructive: isDestructive,
        requireReason: requireReason,
        reasonHint: reasonHint,
        onConfirmWithReason: onConfirmWithReason,
      ),
    );
  }

  @override
  State<AppConfirmDialog> createState() => _AppConfirmDialogState();
}

class _AppConfirmDialogState extends State<AppConfirmDialog> {
  late final TextEditingController _reasonController;
  bool _canSubmit = false;

  @override
  void initState() {
    super.initState();
    _reasonController = TextEditingController();
    _canSubmit = !widget.requireReason;
  }

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: Colors.transparent,
      elevation: 0,
      insetPadding: const EdgeInsets.symmetric(horizontal: 20),
      child: Container(
        width: AppDimensions.dialogWidth,
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: AppDimensions.borderRadiusMd,
          boxShadow: AppDimensions.dialogShadow,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Warning Icon
            Center(
              child: Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  color: widget.isDestructive ? AppColors.dangerBg : AppColors.primaryContainer,
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  widget.isDestructive ? Icons.warning_amber_rounded : Icons.info_outline,
                  color: widget.isDestructive ? AppColors.danger : AppColors.primary,
                  size: 28,
                ),
              ),
            ),

            const SizedBox(height: 16),

            // Title
            Center(
              child: Text(
                widget.title,
                textAlign: TextAlign.center,
                style: AppTypography.headlineMedium(color: AppColors.textPrimary).copyWith(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),

            const SizedBox(height: 10),

            // Message / Consequence explanation
            Text(
              widget.message,
              textAlign: TextAlign.center,
              style: AppTypography.bodyMedium(color: AppColors.textSecondary),
            ),

            const SizedBox(height: 16),

            // Required Reason Input (if enabled)
            if (widget.requireReason) ...[
              Text(
                'LÝ DO THỰC HIỆN *',
                style: AppTypography.labelMedium(color: AppColors.textPrimary),
              ),
              const SizedBox(height: 6),
              TextField(
                controller: _reasonController,
                maxLines: 3,
                style: AppTypography.bodyMedium(),
                onChanged: (val) {
                  setState(() {
                    _canSubmit = val.trim().isNotEmpty;
                  });
                },
                decoration: InputDecoration(
                  hintText: widget.reasonHint,
                  hintStyle: AppTypography.bodySmall(color: AppColors.textMuted),
                  filled: true,
                  fillColor: AppColors.surfaceMuted,
                  border: OutlineInputBorder(
                    borderRadius: AppDimensions.borderRadiusMd,
                    borderSide: const BorderSide(color: AppColors.borderStrong),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: AppDimensions.borderRadiusMd,
                    borderSide: const BorderSide(color: AppColors.borderStrong),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: AppDimensions.borderRadiusMd,
                    borderSide: BorderSide(
                      color: widget.isDestructive ? AppColors.danger : AppColors.primary,
                      width: 1.5,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 20),
            ],

            // Action Buttons
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.of(context).pop(false),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      side: const BorderSide(color: AppColors.borderStrong),
                      shape: RoundedRectangleBorder(
                        borderRadius: AppDimensions.borderRadiusMd,
                      ),
                    ),
                    child: Text(
                      widget.cancelLabel,
                      style: AppTypography.bodyMedium(color: AppColors.textSecondary).copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton(
                    onPressed: _canSubmit
                        ? () {
                            if (widget.onConfirmWithReason != null) {
                              widget.onConfirmWithReason!(_reasonController.text.trim());
                            }
                            widget.onConfirm?.call();
                            Navigator.of(context).pop(true);
                          }
                        : null,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: widget.isDestructive ? AppColors.danger : AppColors.primary,
                      disabledBackgroundColor: AppColors.border,
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      elevation: 0,
                      shape: RoundedRectangleBorder(
                        borderRadius: AppDimensions.borderRadiusMd,
                      ),
                    ),
                    child: Text(
                      widget.confirmLabel,
                      style: AppTypography.bodyMedium(color: Colors.white).copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

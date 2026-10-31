import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/admin_session_model.dart';

class AuthStorageService {
  static const String _sessionKey = 'admin_session_data';

  final SharedPreferences? _prefs;

  AuthStorageService({SharedPreferences? prefs}) : _prefs = prefs;

  Future<SharedPreferences> _getPrefs() async {
    return _prefs ?? await SharedPreferences.getInstance();
  }

  /// Lưu toàn bộ thông tin phiên làm việc của Quản trị viên
  Future<void> saveSession(AdminSessionModel session) async {
    final prefs = await _getPrefs();
    final jsonStr = jsonEncode(session.toJson());
    await prefs.setString(_sessionKey, jsonStr);
  }

  /// Đọc phiên làm việc từ bộ nhớ bền vững (LocalStorage)
  Future<AdminSessionModel?> getSession() async {
    try {
      final prefs = await _getPrefs();
      final jsonStr = prefs.getString(_sessionKey);
      if (jsonStr == null || jsonStr.isEmpty) {
        return null;
      }
      final Map<String, dynamic> data = jsonDecode(jsonStr);
      final session = AdminSessionModel.fromJson(data);
      if (session.accessToken.isEmpty) {
        return null;
      }
      return session;
    } catch (_) {
      await clearSession();
      return null;
    }
  }

  /// Xóa phiên làm việc khi đăng xuất
  Future<void> clearSession() async {
    try {
      final prefs = await _getPrefs();
      await prefs.remove(_sessionKey);
    } catch (_) {}
  }
}

import 'package:flutter/material.dart';

class AppDimensions {
  // Shell Dimensions
  static const double sidebarWidth = 260.0;
  static const double topbarHeight = 64.0;
  static const double drawerWidth = 480.0;
  static const double dialogWidth = 440.0;

  // Spacing & Padding
  static const double paddingCanvas = 24.0;
  static const double gutter = 20.0;
  static const double spaceXs = 4.0;
  static const double spaceSm = 8.0;
  static const double spaceMd = 16.0;
  static const double spaceLg = 24.0;
  static const double spaceXl = 32.0;

  // Border Radius (Soft System from Stitch)
  static const double radiusSm = 4.0; // Badge, tags, checkboxes
  static const double radiusMd = 8.0; // Inputs, cards, buttons, dialogs
  static const double radiusLg = 12.0;
  static const double radiusFull = 9999.0;

  static final BorderRadius borderRadiusSm = BorderRadius.circular(radiusSm);
  static final BorderRadius borderRadiusMd = BorderRadius.circular(radiusMd);
  static final BorderRadius borderRadiusLg = BorderRadius.circular(radiusLg);
  static final BorderRadius borderRadiusFull = BorderRadius.circular(radiusFull);

  // Elevation Shadows
  static const List<BoxShadow> cardShadow = [
    BoxShadow(
      color: Color.fromRGBO(15, 23, 42, 0.04),
      offset: Offset(0, 1),
      blurRadius: 2,
    ),
  ];

  static const List<BoxShadow> drawerShadow = [
    BoxShadow(
      color: Color.fromRGBO(15, 23, 42, 0.12),
      offset: Offset(-8, 0),
      blurRadius: 24,
    ),
  ];

  static const List<BoxShadow> dialogShadow = [
    BoxShadow(
      color: Color.fromRGBO(15, 23, 42, 0.1),
      offset: Offset(0, 20),
      blurRadius: 25,
      spreadRadius: -5,
    ),
    BoxShadow(
      color: Color.fromRGBO(15, 23, 42, 0.06),
      offset: Offset(0, 8),
      blurRadius: 10,
      spreadRadius: -6,
    ),
  ];
}

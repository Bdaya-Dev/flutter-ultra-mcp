import 'package:flutter/material.dart';

import 'src/devtools_extension.dart';

void main() {
  runApp(
    const MaterialApp(
      title: 'Ultra Flutter DevTools',
      debugShowCheckedModeBanner: false,
      home: UltraFlutterDevToolsExtension(),
    ),
  );
}

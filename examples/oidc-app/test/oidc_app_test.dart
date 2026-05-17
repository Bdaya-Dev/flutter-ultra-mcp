import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:oidc_app/main.dart';

void main() {
  testWidgets('shows login button initially', (tester) async {
    await tester.pumpWidget(const OidcApp());

    expect(find.text('Not authenticated'), findsOneWidget);
    expect(find.byKey(const Key('login_button')), findsOneWidget);
  });
}

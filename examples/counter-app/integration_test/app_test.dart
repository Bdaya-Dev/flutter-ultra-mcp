import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:counter_app/main.dart' as app;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  group('Counter App E2E', () {
    testWidgets('counter starts at 0 and increments', (tester) async {
      app.main();
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('counter_value')), findsOneWidget);
      expect(find.text('0'), findsOneWidget);

      await tester.tap(find.byKey(const Key('increment')));
      await tester.pumpAndSettle();

      expect(find.text('1'), findsOneWidget);
    });

    testWidgets('counter decrements', (tester) async {
      app.main();
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('increment')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('decrement')));
      await tester.pumpAndSettle();

      expect(find.text('0'), findsOneWidget);
    });
  });
}

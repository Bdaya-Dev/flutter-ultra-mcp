import 'dart:convert';
import 'dart:developer' as developer;

import 'package:flutter/foundation.dart';
import 'package:ultra_flutter/src/binding/ultra_extension_result.dart';
import 'package:ultra_flutter/src/binding/register_extension.dart';

/// Registers a built-in Marionette service extension.
///
/// This is intended for internal use by [UltraFlutterBinding] only. Unlike
/// [registerUltraExtension], it does **not** add the extension to the
/// [customExtensionRegistry].
///
/// The `ext.flutter.` prefix is added automatically to [name].
///
/// Uses [developer.registerExtension] directly, bypassing Flutter's
/// [BindingBase.registerServiceExtension].
void registerInternalUltraExtension({
  required String name,
  required UltraExtensionCallback callback,
}) {
  final methodName = 'ext.flutter.$name';

  developer.registerExtension(
    methodName,
    (method, parameters) async {
      // Wait for the outer event loop, same as Flutter's
      // registerServiceExtension, to avoid handling extensions in the middle
      // of a frame.
      await Future<void>.delayed(Duration.zero);

      late final UltraExtensionResult result;
      try {
        result = await callback(parameters);
      } on ArgumentError catch (e) {
        return developer.ServiceExtensionResponse.error(
          developer.ServiceExtensionResponse.invalidParams,
          e.message?.toString() ?? e.toString(),
        );
      } catch (exception, stack) {
        FlutterError.reportError(
          FlutterErrorDetails(
            exception: exception,
            stack: stack,
            context: ErrorDescription(
              'during a service extension callback for "$method"',
            ),
          ),
        );

        return developer.ServiceExtensionResponse.error(
          developer.ServiceExtensionResponse.extensionError,
          json.encode(<String, String>{
            'exception': exception.toString(),
            'stack': stack.toString(),
            'method': method,
          }),
        );
      }

      switch (result) {
        case UltraExtensionSuccess(:final data):
          final responseData = Map<String, Object?>.from(data);
          responseData['type'] = '_extensionType';
          responseData['method'] = method;
          responseData['status'] = 'Success';
          return developer.ServiceExtensionResponse.result(
            json.encode(responseData),
          );
        case UltraExtensionError(:final code, :final detail):
          return developer.ServiceExtensionResponse.error(
            developer.ServiceExtensionResponse.extensionErrorMin + code,
            detail,
          );
        case UltraExtensionInvalidParams(:final detail):
          return developer.ServiceExtensionResponse.error(
            developer.ServiceExtensionResponse.invalidParams,
            detail,
          );
      }
    },
  );
}

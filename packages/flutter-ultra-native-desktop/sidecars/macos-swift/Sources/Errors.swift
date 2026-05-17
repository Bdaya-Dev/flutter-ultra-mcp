// Errors.swift — error code constants shared with the TS side
// (see ../../src/backends/macos.ts MAC_ERR_*).

import Foundation
import ApplicationServices

enum HelperError: Error, CustomStringConvertible {
    case tccNotGranted
    case windowNotFound(String)
    case elementNotFound(String)
    case axFailure(String, AXError)
    case dialogTimeout(String)
    case invalidParam(String)
    case unsupported(String)

    var code: Int {
        switch self {
        case .tccNotGranted: return -32_000
        case .windowNotFound: return -32_001
        case .elementNotFound: return -32_002
        case .axFailure: return -32_003
        case .dialogTimeout: return -32_004
        case .invalidParam: return -32_602  // standard JSON-RPC "invalid params"
        case .unsupported: return -32_601   // standard JSON-RPC "method not found"
        }
    }

    var description: String {
        switch self {
        case .tccNotGranted:
            return "Accessibility permission not granted"
        case .windowNotFound(let id):
            return "Window not found: \(id)"
        case .elementNotFound(let id):
            return "Element not found: \(id)"
        case .axFailure(let what, let err):
            return "AX \(what) failed: \(axErrorName(err)) (\(err.rawValue))"
        case .dialogTimeout(let what):
            return "Dialog operation timed out: \(what)"
        case .invalidParam(let what):
            return "Invalid parameter: \(what)"
        case .unsupported(let what):
            return "Unsupported: \(what)"
        }
    }
}

func axErrorName(_ err: AXError) -> String {
    switch err {
    case .success: return "success"
    case .failure: return "failure"
    case .illegalArgument: return "illegalArgument"
    case .invalidUIElement: return "invalidUIElement"
    case .invalidUIElementObserver: return "invalidUIElementObserver"
    case .cannotComplete: return "cannotComplete"
    case .attributeUnsupported: return "attributeUnsupported"
    case .actionUnsupported: return "actionUnsupported"
    case .notificationUnsupported: return "notificationUnsupported"
    case .notImplemented: return "notImplemented"
    case .notificationAlreadyRegistered: return "notificationAlreadyRegistered"
    case .notificationNotRegistered: return "notificationNotRegistered"
    case .apiDisabled: return "apiDisabled"
    case .noValue: return "noValue"
    case .parameterizedAttributeUnsupported: return "parameterizedAttributeUnsupported"
    case .notEnoughPrecision: return "notEnoughPrecision"
    @unknown default: return "unknown(\(err.rawValue))"
    }
}

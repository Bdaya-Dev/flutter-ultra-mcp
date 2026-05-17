// swift-tools-version: 5.9
//
// flutter-ultra-mac-helper — single SwiftPM executable wrapping macOS
// Accessibility (AXUIElement) + CoreGraphics event synthesis for the
// flutter-ultra-native-desktop MCP server.
//
// Build: swift build -c release  → .build/release/flutter-ultra-mac-helper
// Run:   ./flutter-ultra-mac-helper --rpc
// Talk:  newline-delimited JSON-RPC 2.0 on stdin/stdout.
//
// Deployment target 11.0 covers Big Sur+ (Apple Silicon shipped on Big Sur
// onward; AX APIs available much earlier but we lean on
// SecKeyCreateRandomKey-era APIs in TCC.framework so we set a modern floor).

import PackageDescription

let package = Package(
    name: "flutter-ultra-mac-helper",
    platforms: [.macOS(.v11)],
    products: [
        .executable(
            name: "flutter-ultra-mac-helper",
            targets: ["flutter-ultra-mac-helper"]
        )
    ],
    targets: [
        .executableTarget(
            name: "flutter-ultra-mac-helper",
            path: "Sources",
            swiftSettings: [
                .unsafeFlags(["-warnings-as-errors"], .when(configuration: .release))
            ],
            linkerSettings: [
                .linkedFramework("ApplicationServices"),
                .linkedFramework("CoreGraphics"),
                .linkedFramework("Foundation"),
                .linkedFramework("AppKit")
            ]
        )
    ]
)

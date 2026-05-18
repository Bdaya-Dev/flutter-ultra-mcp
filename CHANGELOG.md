## [1.0.2](https://github.com/Bdaya-Dev/flutter-ultra-mcp/compare/v1.0.1...v1.0.2) (2026-05-18)


### Bug Fixes

* add postinstall auto-build so plugin works after marketplace clone ([579a1cd](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/579a1cdecccf10f20a1bcf7bfe128c8ef09ff541))

## [1.0.1](https://github.com/Bdaya-Dev/flutter-ultra-mcp/compare/v1.0.0...v1.0.1) (2026-05-18)


### Bug Fixes

* add source field to marketplace.json for plugin install ([88b64ac](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/88b64ac78eed3ad798556ef08635444939d4ee36))

# 1.0.0 (2026-05-18)


### Bug Fixes

* address 3 CRITICALs + 3 HIGHs from deep review + remove sentry_compat ([#26](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/26)) ([25b7953](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/25b79536938b9ec36c891cb7979e9dc47c70c5ac)), closes [#24](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/24)
* address CodeRabbit findings (1 CRITICAL + 10 MAJOR + 4 MINOR) ([#28](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/28)) ([3828689](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/3828689f8d2c018264013b0d607d82c0b4c42657))
* disable husky in CI so semantic-release can commit changelog ([1101469](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/11014695ecfc3bb28945f0d0e169b1e26cfe7e4c))
* mark sub-packages private (only root @bdayadev/flutter-ultra-mcp publishes to npm) ([29c7b59](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/29c7b590725350695e7e0684c9f4f1b37bf6a06b))
* remove leftover changeset version script blocking semantic-release ([bf73279](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/bf7327904396ad340a9870a1a61016ad852e4666))
* resolve TS build errors in contracts (ajv ESM interop) + native-mobile (arg type inference) ([4e1f8da](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/4e1f8da25b4224b511b8ec765c4e911bd7c1ead9))
* **runtime:** add shell:true for Windows .bat spawn in launch_app ([#37](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/37)) ([32e62c2](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/32e62c2c75fc0d925841ed46611dea26e64ba546))
* **runtime:** surface child crash/exit in launch_app + remove internal references from docs ([#38](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/38)) ([4835ab5](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/4835ab59e5ec32b4736123b81625c2cc80ae27da))
* TS build errors + skip SSH timeout test in CI ([125dc0b](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/125dc0b17c6468ece3e9c69c7f1c5e5e3f561dca))
* use @semantic-release/exec for OIDC-compatible npm publish (zero tokens) ([33b60a2](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/33b60a2653c82a75bc31cefb261fabb8f4f0bd51))
* wire 6 broken MCP server entrypoints + add bin.ts for gesture/browser/patrol ([#29](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/29)) ([1cdd0c1](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/1cdd0c1a24ef57820069cc4b64d683d548fc696f))


### Features

* **browser:** Playwright MCP server with rev-23 console capture ([#12](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/12)) ([d330774](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/d330774a878308042461d953156357b993125f07))
* **build:** MCP server with 94 tools — pubspec, codegen, tests, builds, l10n, assets, signing ([#15](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/15)) ([ed7bb64](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/ed7bb6452032aaa09305c1075ba2a0204e87a2be)), closes [#58004](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/58004)
* **devtools:** implement flutter-ultra-devtools server + ultra_flutter_devtools extension (Wave-4/L) ([#22](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/22)) ([8d222b7](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/8d222b78590674f5dc23f2c2cbc3dc1788616e6b))
* **examples:** add counter-app + OIDC-app examples with per-platform CI workflows ([#21](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/21)) ([a15dde2](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/a15dde2fd9da479c0424915c8c8435aace4a67a5))
* **gesture:** 17-tool MCP server with rev-23 interactive_elements contract ([#13](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/13)) ([d401c40](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/d401c400fdf0f13873b80302297f731f69bfeee7)), closes [#2](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/2)
* **native-desktop:** Linux AT-SPI backend via PyGObject sidecar ([#19](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/19)) ([4194626](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/41946269041d42cb46d39bd26f9e3b2a5ff7cf8b)), closes [flutter/flutter#107016](https://github.com/flutter/flutter/issues/107016) [#17](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/17)
* **native-desktop:** macOS path with Swift AX sidecar + TCC UX (wave-3/J) ([#17](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/17)) ([ddcfb28](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/ddcfb28a92d7c2d295060eda7f435a0bbd44915a))
* **native-desktop:** Windows path via FlaUI C# sidecar (Wave-3/I) ([#20](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/20)) ([d331144](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/d331144d87f631027feb7365690fc4627465a58e)), closes [#17](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/17) [#32770](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/32770)
* **native-mobile:** MCP server with 22 tools — Android + iOS + CCT OAuth ([#18](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/18)) ([14c9cad](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/14c9cadcc671811863cdde640115694d72596ae5))
* **patrol:** flutter-ultra-patrol MCP server with 13 tools ([#16](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/16)) ([c222dba](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/c222dba85b8f7673eaf90a41916181eb221d5541)), closes [#11](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/11) [#10](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/10) [#11](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/11)
* **runtime:** MCP server with 28 tools + shared mcp-runtime/state-store scaffolding ([#14](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/14)) ([b613d8e](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/b613d8e8b7f564fc3fc02f718e29310782feaed0)), closes [#58004](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/58004)
* **scaffold:** add 8 MCP server package stubs ([deeafc6](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/deeafc68855317869a05fd2f707d1a8392c90e0e))
* **scaffold:** add Dart package stubs ([f327c71](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/f327c71fc489f57fe29f4cac7d5b5f8ecf07f52c))
* **scaffold:** add plugin manifest and MCP server config ([a995db8](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/a995db82b08bfddf21871e4ad46ada6e99982348))
* **scaffold:** add shared library package stubs ([20c0d8a](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/20c0d8afa09cdda582d67f93cb5a46438b6642ee))
* **scaffold:** add skill stubs (6 user + 2 internal) ([8426c0f](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/8426c0f48aeb47c93a928190068f7fc88c40bdba))
* **shared:** add @flutter-ultra/device-router package ([#24](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/24)) ([9a3fe93](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/9a3fe93872fdf3f7f390a44f3a710d270f28f288))
* **shared:** add contract test infrastructure for ext.flutter.ultra.* wire format (AC-TS3) ([#25](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/25)) ([cb42237](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/cb42237f24c9a6c6b7c2b17f348dd758a43a671b))
* switch to semantic-release for fully automated npm publishing ([a32de7b](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/a32de7b7b50112685ccd007d670e526db73232da))
* switch to semantic-release for fully automated npm publishing ([b89711b](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/b89711ba7dcafb058ce77d738dc656e9603d9fd5))
* **ultra_flutter:** port marionette_flutter as mixin binding with Sentry compat package ([#6](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/6)) ([e0716ab](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/e0716ab0a85571a099e5169f7a886cfc07a54b88)), closes [#2](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/2)
* **vm-service-client:** port Dart VM service subset to TypeScript with DDS multi-client ([#3](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/3)) ([2430a10](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/2430a10a84cdc0179d4b133d0fc3cc036667df15)), closes [post-PR-#11](https://github.com/post-PR-/issues/11)

## [1.10.8](https://github.com/Bdaya-Dev/flutter-ultra-mcp/compare/v1.10.7...v1.10.8) (2026-05-20)


### Bug Fixes

* **ci:** apply audit findings — timeouts, permissions, caching, persist-credentials ([26f8c3a](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/26f8c3a8f05cfe8fe9c3a510938ec75755ffcd02))

## [1.10.7](https://github.com/Bdaya-Dev/flutter-ultra-mcp/compare/v1.10.6...v1.10.7) (2026-05-20)


### Bug Fixes

* **release:** replace reusable workflow with direct flutter pub publish ([0751b73](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/0751b736253a0120ceae17d48d81f19a2a7c1548))

## [1.10.6](https://github.com/Bdaya-Dev/flutter-ultra-mcp/compare/v1.10.5...v1.10.6) (2026-05-20)


### Bug Fixes

* **release:** add actions:write permission for workflow_dispatch trigger ([eb1f8a1](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/eb1f8a130fd23998ed12a48157e293bd8e8b5603))

## [1.10.5](https://github.com/Bdaya-Dev/flutter-ultra-mcp/compare/v1.10.4...v1.10.5) (2026-05-20)


### Bug Fixes

* **release:** pub.dev publish via workflow_dispatch with tag ref ([5eba165](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/5eba165e16e9b58ce243d7dc4d834050d335f991)), closes [dart-lang/pub-dev#8507](https://github.com/dart-lang/pub-dev/issues/8507)

## [1.10.4](https://github.com/Bdaya-Dev/flutter-ultra-mcp/compare/v1.10.3...v1.10.4) (2026-05-20)


### Bug Fixes

* **release:** bump pubspec.yaml versions in semantic-release prepareCmd ([25b8b89](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/25b8b89bfe601830f7b6f4be292e8fe4ac238501))

## [1.10.3](https://github.com/Bdaya-Dev/flutter-ultra-mcp/compare/v1.10.2...v1.10.3) (2026-05-20)


### Bug Fixes

* **release:** trigger pub.dev publish via workflow_run, not tag push ([6587a45](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/6587a45f338de3b91eda8718c4b5733f5f226099))

## [1.10.2](https://github.com/Bdaya-Dev/flutter-ultra-mcp/compare/v1.10.1...v1.10.2) (2026-05-20)


### Bug Fixes

* **browser:** eslint no-explicit-any on webPerf.ts ([37e1f2a](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/37e1f2a5c288768f37310ccd9409cb1553fa6fa7))

## [1.10.1](https://github.com/Bdaya-Dev/flutter-ultra-mcp/compare/v1.10.0...v1.10.1) (2026-05-20)


### Bug Fixes

* **ci:** format all source files for CI green ([5b082b3](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/5b082b3709d95f31cd5c61625ce96fcf49ad4147))
* **release:** use dart-lang/setup-dart reusable workflow for pub.dev OIDC ([4069211](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/40692113d27e5fe975f47fe33b55dd560c804565))

# [1.10.0](https://github.com/Bdaya-Dev/flutter-ultra-mcp/compare/v1.9.4...v1.10.0) (2026-05-20)


### Bug Fixes

* **browser:** use script file for playwright-core SessionStart hook ([#86](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/86)) ([7d9d331](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/7d9d331312936071e6bafef27254ac2b7500bbe5))
* **docs:** correct binding initialization examples ([57dd74d](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/57dd74d6f3284ab75a9f3fc48cbf87b91f06056e))
* **runtime:** fallback to ultra.* extensions on web when inspector fails ([#86](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/86)) ([87f3e82](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/87f3e82fd75b94a793122edd16038e2e6d525ff5))


### Features

* **runtime:** auto-allocate CDP port for web targets in launch_app ([4ece896](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/4ece896ae9921357bbf1eebafac83131adc3ed4a))

## [1.9.4](https://github.com/Bdaya-Dev/flutter-ultra-mcp/compare/v1.9.3...v1.9.4) (2026-05-20)


### Bug Fixes

* **skills:** ultra_flutter is a dependency, not dev_dependency ([2a1d86d](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/2a1d86d230fc88eda7408ae5885c6ad3bb27e1ee))

## [1.9.3](https://github.com/Bdaya-Dev/flutter-ultra-mcp/compare/v1.9.2...v1.9.3) (2026-05-19)


### Bug Fixes

* **browser:** install playwright-core to CLAUDE_PLUGIN_DATA (persistent) ([#86](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/86)) ([4d4025e](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/4d4025e0a4c72f7ea02f8065dc1c95d200466068))

## [1.9.2](https://github.com/Bdaya-Dev/flutter-ultra-mcp/compare/v1.9.1...v1.9.2) (2026-05-19)


### Bug Fixes

* **browser:** auto-install playwright-core via SessionStart hook ([#86](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/86)) ([e878305](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/e87830553c13c479852ef5f92ef4966b1dc28a03))

## [1.9.1](https://github.com/Bdaya-Dev/flutter-ultra-mcp/compare/v1.9.0...v1.9.1) (2026-05-19)


### Bug Fixes

* **ultra_flutter:** binding crash on Flutter 3.x — check _instance not getter ([#86](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/86)) ([0a19e89](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/0a19e89e57d5a656487fb3ac650aba8088709ef5))

# [1.9.0](https://github.com/Bdaya-Dev/flutter-ultra-mcp/compare/v1.8.0...v1.9.0) (2026-05-19)


### Features

* **runtime:** Figma design integration — component inventory + 2 skills ([#84](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/84)) ([8bd2c09](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/8bd2c096a73ae214a925277058326c73d46e8892))
* **runtime:** Flutter-native design audit — accessibility, responsive, theme ([#85](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/85)) ([150423b](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/150423b200df48ee036d9b5e341eeb6c28dc16ae))
* video/GIF recording across all platforms ([#82](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/82)) ([b9ae6ab](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/b9ae6ab82acffb947dfe6cbc7b803726d55e9489))

# [1.8.0](https://github.com/Bdaya-Dev/flutter-ultra-mcp/compare/v1.7.0...v1.8.0) (2026-05-19)


### Features

* **patrol:** wire 9 CLI flags + run_patrol_doctor + inline base64 screenshots ([#83](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/83)) ([10b59ec](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/10b59ec907d518a336f2d7916cf7d3cf1af14be5))

# [1.7.0](https://github.com/Bdaya-Dev/flutter-ultra-mcp/compare/v1.6.0...v1.7.0) (2026-05-19)


### Features

* **skills:** rewrite all 8 skills with full tool catalog + best practices ([f9808b1](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/f9808b18ffc6de519f90941c47389dd6037a1b78))

# [1.6.0](https://github.com/Bdaya-Dev/flutter-ultra-mcp/compare/v1.5.8...v1.6.0) (2026-05-19)


### Features

* **runtime:** performance monitoring — CPU, memory, frames, timeline, rebuilds ([#81](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/81)) ([68a6f92](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/68a6f92c021f7cf5a338df391439e07f30aaec99))

## [1.5.8](https://github.com/Bdaya-Dev/flutter-ultra-mcp/compare/v1.5.7...v1.5.8) (2026-05-19)


### Bug Fixes

* **devtools:** relax WebSocket close propagation wait 50→500ms ([c8b2b7b](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/c8b2b7b199748de8e888090413f316714eedfe78))

## [1.5.7](https://github.com/Bdaya-Dev/flutter-ultra-mcp/compare/v1.5.6...v1.5.7) (2026-05-19)


### Bug Fixes

* **patrol:** await lastPersist instead of waitMs in persistence tests ([aeed705](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/aeed70517f17eb2ec86b60cb2b22cd8c9c7f5f14))

## [1.5.6](https://github.com/Bdaya-Dev/flutter-ultra-mcp/compare/v1.5.5...v1.5.6) (2026-05-19)


### Bug Fixes

* **patrol:** bump persistence test waitMs 100→500 for Windows CI ([bd47ee4](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/bd47ee4075eaa9a7c2348455d2ef68bad4bf336b))

## [1.5.5](https://github.com/Bdaya-Dev/flutter-ultra-mcp/compare/v1.5.4...v1.5.5) (2026-05-19)


### Bug Fixes

* **ci:** workspace path resolution, flaky timing, temp dir cleanup ([048f5a9](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/048f5a951b06fb283b0d3c624d1bcfa56a3344b0))

## [1.5.4](https://github.com/Bdaya-Dev/flutter-ultra-mcp/compare/v1.5.3...v1.5.4) (2026-05-19)


### Bug Fixes

* **ci:** WSL test on CI + mobile E2E workspace path resolution ([a5f7628](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/a5f7628d48fcbab43f52ae8825f633c0a016707e))

## [1.5.3](https://github.com/Bdaya-Dev/flutter-ultra-mcp/compare/v1.5.2...v1.5.3) (2026-05-19)


### Bug Fixes

* **ci:** remove gitleaks — public OSS repo has no secrets to scan ([5395e93](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/5395e934604fe4b2fa2af421b20c609647f574eb))
* **ci:** replace gitleaks-action with free CLI (org license required) ([3fd7cdb](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/3fd7cdb21d7467a32b8da4700fede07db965a88f))

## [1.5.2](https://github.com/Bdaya-Dev/flutter-ultra-mcp/compare/v1.5.1...v1.5.2) (2026-05-19)


### Bug Fixes

* **ci:** osv-scanner CLI, web E2E test scope, integration test binding ([405a2b6](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/405a2b61550e6bd95181dc9f0daabbe82bc73726))

## [1.5.1](https://github.com/Bdaya-Dev/flutter-ultra-mcp/compare/v1.5.0...v1.5.1) (2026-05-19)


### Bug Fixes

* **ci:** green all CI workflows — format, Dart pub, simulator, desktop, emulator ([904f824](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/904f824e6bafec68d58439800e93ecacc375e89d))

# [1.5.0](https://github.com/Bdaya-Dev/flutter-ultra-mcp/compare/v1.4.0...v1.5.0) (2026-05-19)


### Features

* **ci:** E2E test infrastructure for all platforms ([#59](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/59), [#70](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/70)) ([4e1dca4](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/4e1dca4fb36d7888b2bbaf3a3c66a9ee6f8330a1))

# [1.4.0](https://github.com/Bdaya-Dev/flutter-ultra-mcp/compare/v1.3.2...v1.4.0) (2026-05-19)


### Bug Fixes

* **ci:** format all source files + fix build errors ([abb93ab](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/abb93abea4526dae273b8904578142fe89958f28))
* **ci:** sync plugin manifest versions with semantic-release ([71f75cb](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/71f75cb4b43099585867c16584b11120ca03a7e1))
* **mcp-runtime:** remove unused collector param from createDiagnosticsTool ([ef99a86](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/ef99a86e42a4c309de0adb4e33c06cf7860cfdfb))
* **patrol:** resolve Windows crashes and stale result masking ([#72](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/72), [#73](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/73), [#75](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/75)) ([8819814](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/8819814f2c4b541be045e8a33f97f3c74e1a2e3f))


### Features

* **ci:** add osv-scanner + SLSA provenance comment ([#60](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/60)) ([3a6c37d](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/3a6c37d0b99ba3cab026800c8b08a3dd5f914815))
* **ci:** security gates, schema tests, timeouts, plugin validation ([#48](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/48), [#53](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/53), [#61](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/61)) ([c3e5083](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/c3e50833ee19b52b6941dd826438f0dd40675344))
* **patrol:** add extract_video_frame tool for failure diagnosis ([#43](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/43)) ([f6bfe43](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/f6bfe434199e9b00aaab0cb139675cb2367c1d72))
* **patrol:** enrich diagnostics and streaming ([#44](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/44), [#45](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/45), [#46](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/46), [#47](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/47)) ([1810129](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/1810129f07f2d54da665ece6009dea554d7d82c6))
* **patrol:** persist job state across server restarts ([#52](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/52)) ([0930615](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/0930615a917a859b9d5764270d3765661271e553))
* **skills:** add flutter-bisect skill for automated git bisect ([#51](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/51)) ([82721f3](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/82721f348c0e6e04b8e002aac749c217c5e5d6de))
* **skills:** implement all 7 SKILL.md files ([#63](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/63), [#64](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/64), [#65](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/65), [#66](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/66), [#67](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/67), [#68](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/68), [#69](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/69)) ([8840144](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/8840144c1359a4a837e61b91c9a79acee242698d))
* **state-store:** schema versioning + orphan cleanup on startup ([#57](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/57)) ([726ef47](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/726ef47255e02bc8e8cdbeea23d94d710ab5a235))
* token redaction, observability, release workflows ([#54](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/54), [#56](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/56), [#58](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/58)) ([23635f2](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/23635f25d7156ff4231d604f402002bb1d053fcb))

## [1.3.2](https://github.com/Bdaya-Dev/flutter-ultra-mcp/compare/v1.3.1...v1.3.2) (2026-05-19)


### Bug Fixes

* **ci:** sync plugin manifest versions with semantic-release ([#78](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/78)) ([a3052d3](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/a3052d36769d1e49c9e5876eb4a84ad440108340))

## [1.3.1](https://github.com/Bdaya-Dev/flutter-ultra-mcp/compare/v1.3.0...v1.3.1) (2026-05-19)


### Bug Fixes

* **runtime:** parse two-element --dart-define from launch.json args ([#76](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/76)) ([5c964df](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/5c964df57171147be32f286ce43847b61cc7a177)), closes [#41](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/41)
* **runtime:** pre-launch port cleanup for orphan processes ([#77](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/77)) ([9b9b584](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/9b9b58450b8c5ee58e084389ad1b36f3e7e6a33d)), closes [#74](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/74)

# [1.3.0](https://github.com/Bdaya-Dev/flutter-ultra-mcp/compare/v1.2.0...v1.3.0) (2026-05-19)


### Features

* **browser:** add connect_over_cdp tool for CDP attachment ([#71](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/71)) ([e08a99f](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/e08a99f5973ff0a0e88b03b3e37e20a7ad4d1406)), closes [#42](https://github.com/Bdaya-Dev/flutter-ultra-mcp/issues/42)

# [1.2.0](https://github.com/Bdaya-Dev/flutter-ultra-mcp/compare/v1.1.0...v1.2.0) (2026-05-19)


### Bug Fixes

* **patrol:** update tests for Windows dart.bat + arg stripping ([ccaf00d](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/ccaf00d121ca2a125a7a13e52ac1cb7ddfaa6190))
* **runtime:** add try/catch to web VM service discovery ([b22e5da](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/b22e5dabada9b3ddbb2da6d87e087eb0c25e0514))
* **runtime:** detect VM service on web targets via discovery ([98094e8](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/98094e8819290677e0aa47e849f3779e991b4b9d))
* **runtime:** skip auto-attach on web targets (DDS single-client) ([3c934df](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/3c934df9fb917b524688e077f33d96e3c84d7593))
* **runtime:** use z.any() for service extension params schema ([f8bb09b](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/f8bb09ba6a1a17ec935f85015a62bf13cfa0877b))
* Windows spawn compatibility across build, patrol, runtime ([fff2ec5](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/fff2ec56e71075ee16c873fcd446f67cec0f408d))


### Features

* **runtime:** add runtime_version tool + stderr debug logging ([c9a73f7](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/c9a73f74a9bf62b8cf19de7db5aef4a16238b0c7))
* **runtime:** stdin proxy for VM service calls + headless web default ([0f5585f](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/0f5585f4d93fa55179a26cbc1eb7c333b28a189e))

# [1.1.0](https://github.com/Bdaya-Dev/flutter-ultra-mcp/compare/v1.0.2...v1.1.0) (2026-05-18)


### Features

* bundle MCP servers into self-contained .cjs via esbuild ([5e9217e](https://github.com/Bdaya-Dev/flutter-ultra-mcp/commit/5e9217e786c87eb178a40801f904c412046bc843))

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

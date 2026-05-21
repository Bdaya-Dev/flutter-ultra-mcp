---
name: apply-architecture-best-practices
description: Architects a Flutter application using the recommended layered approach (UI, Logic, Data). Use when structuring a new project or refactoring for scalability.
---

# Architecting Flutter Applications

## Contents

- [Architectural Layers](#architectural-layers)
- [Project Structure](#project-structure)
- [Workflow: Implementing a New Feature](#workflow-implementing-a-new-feature)
- [Examples](#examples)

## Architectural Layers

Enforce strict Separation of Concerns by dividing the application into distinct layers.

### UI Layer (Presentation)

Implement the MVVM (Model-View-ViewModel) pattern.

- **Views:** Reusable, lean widgets. Restrict logic to UI-specific operations.
- **ViewModels:** Manage UI state. Extend `ChangeNotifier`. Expose immutable state snapshots. Inject Repositories via constructor.

### Data Layer

Implement the Repository pattern for a single source of truth.

- **Services:** Stateless classes wrapping external APIs. Return raw API models or `Result` wrappers.
- **Repositories:** Consume Services. Transform raw models into Domain Models. Handle caching and retry logic.

### Logic Layer (Domain - Optional)

- **Use Cases:** Only if complex business logic clutters the ViewModel, or logic must be reused across ViewModels.

## Project Structure

```text
lib/
├── data/
│   ├── models/         # API models
│   ├── repositories/   # Repository implementations
│   └── services/       # API clients, local storage wrappers
├── domain/
│   ├── models/         # Clean domain models
│   └── use_cases/      # Optional business logic classes
└── ui/
    ├── core/           # Shared widgets, themes, typography
    └── features/
        └── [feature_name]/
            ├── view_models/
            └── views/
```

## Workflow: Implementing a New Feature

### Task Progress

- [ ] **Step 1:** Define Domain Models (immutable data classes).
- [ ] **Step 2:** Implement Services (external API communication).
- [ ] **Step 3:** Implement Repositories (consume Services, return Domain Models).
- [ ] **Step 4:** Apply Conditional Logic:
  - Complex data transformation or cross-repository logic: Create a Use Case.
  - Simple CRUD: Skip to Step 5.
- [ ] **Step 5:** Implement the ViewModel (extend `ChangeNotifier`, inject Repositories).
- [ ] **Step 6:** Implement the View (use `ListenableBuilder` to listen to ViewModel).
- [ ] **Step 7:** Inject Dependencies (register in DI container).
- [ ] **Step 8:** Run tests. Feedback Loop: Run -> Review -> Fix -> Re-run.

## Examples

### Data Layer: Service and Repository

```dart
class ApiClient {
  Future<UserApiModel> fetchUser(String id) async { /* ... */ }
}

class UserRepository {
  UserRepository({required ApiClient apiClient}) : _apiClient = apiClient;
  final ApiClient _apiClient;
  User? _cachedUser;

  Future<User> getUser(String id) async {
    if (_cachedUser != null) return _cachedUser!;
    final apiModel = await _apiClient.fetchUser(id);
    _cachedUser = User(id: apiModel.id, name: apiModel.fullName);
    return _cachedUser!;
  }
}
```

### UI Layer: ViewModel and View

```dart
class ProfileViewModel extends ChangeNotifier {
  ProfileViewModel({required UserRepository userRepository})
      : _userRepository = userRepository;
  final UserRepository _userRepository;

  User? _user;
  User? get user => _user;
  bool _isLoading = false;
  bool get isLoading => _isLoading;

  Future<void> loadProfile(String id) async {
    _isLoading = true;
    notifyListeners();
    try {
      _user = await _userRepository.getUser(id);
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }
}

class ProfileView extends StatelessWidget {
  const ProfileView({super.key, required this.viewModel});
  final ProfileViewModel viewModel;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: viewModel,
      builder: (context, _) {
        if (viewModel.isLoading) return const Center(child: CircularProgressIndicator());
        final user = viewModel.user;
        if (user == null) return const Center(child: Text('User not found'));
        return Column(children: [
          Text(user.name),
          ElevatedButton(
            onPressed: () => viewModel.loadProfile(user.id),
            child: const Text('Refresh'),
          ),
        ]);
      },
    );
  }
}
```

## Flutter Ultra Integration

Use these tools to audit and validate architectural decisions:

- `mcp__plugin_flutter_flutter-ultra-build__list_projects` — Discover all projects in the workspace
- `mcp__plugin_flutter_flutter-ultra-build__project_info` — Get project structure, dependencies, and entry points
- `mcp__plugin_flutter_flutter-ultra-build__analyze` — Run static analysis to catch architectural violations
- `mcp__plugin_flutter_flutter-ultra-build__pub_deps` — Review dependency graph for layering issues

---

> **Attribution:** This skill is vendored from [flutter/skills](https://github.com/flutter/skills) (BSD-3-Clause).
> Synced by `scripts/sync-upstream-skills.mjs`. Do not edit manually — changes will be overwritten on next sync.

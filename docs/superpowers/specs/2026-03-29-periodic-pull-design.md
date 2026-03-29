# Folder Git Sync Secure: Scheduled Pull-Only Feature Design

Date: 2026-03-29  
Status: Draft for review

## 1. Goal

Add a new global setting-driven feature that performs **pull-only** background sync checks on a schedule.

User-approved behavior:
- Default OFF.
- Interval default `86400` seconds.
- If enabled, run one pull cycle immediately on Obsidian startup.
- Then run recurring pull cycles at the configured interval.
- Recompute schedule when configuration changes; apply immediately.
- Interval `0` is treated as disabled.
- Applies to **all mappings**.
- Preserve existing auto-sync behavior (no changes unless unavoidable).

## 2. Non-Goals

- No changes to event-driven auto-sync semantics.
- No new commit/push behavior in this feature.
- No UI notifications on successful scheduled pulls.
- No new credential/auth storage or auth flows.

## 3. Settings Model Changes

Add two global settings fields:
- `periodicPullEnabled: boolean` (default: `false`)
- `periodicPullIntervalSeconds: number` (default: `86400`)

Effective enabled rule:
- `isPeriodicPullEnabled = periodicPullEnabled && periodicPullIntervalSeconds > 0`

UI additions in settings tab:
- Toggle: `Enable scheduled pull`
- Numeric input: `Pull interval (seconds)`
- Help text:
  - Pull-only behavior
  - Applies to all mappings
  - Interval `0` disables the feature
  - Existing auto-sync behavior remains separate

## 4. Architecture

Add a dedicated manager:
- File: `src/sync/periodicPull.ts`
- Class: `PeriodicPullManager extends Component`

Responsibilities:
- Own global timer lifecycle for scheduled pull-only cycles.
- Run immediate pull cycle on activation (startup/config change) when enabled.
- Run recurring interval pull cycles.
- Prevent overlapping cycles with an internal `running` guard.
- Use existing `SyncManager` for per-mapping queueing/backoff.

Integration:
- Instantiate in `main.ts` `onload` alongside `AutoSyncManager`.
- Register as child component for cleanup on unload.
- Wire settings-change callback so schedule is reapplied whenever settings are saved.

## 5. Runtime Flow

### 5.1 Startup

1. Plugin loads settings.
2. `PeriodicPullManager.start()` is called.
3. If feature enabled:
   - run one immediate cycle
   - start interval timer using current configured interval seconds
4. If disabled:
   - no timer is active

### 5.2 On Settings Change

When any plugin setting is saved:
1. `PeriodicPullManager` receives refresh signal.
2. Existing timer is cleared.
3. If feature enabled:
   - run one immediate cycle
   - start interval timer from change time
4. If disabled:
   - remain idle

### 5.3 Per-Cycle Mapping Execution

For each mapping:
1. Enqueue `pull` job through `SyncManager` (`respectBackoff = true`).
2. Run existing `gitService.pull(mapping)`.
3. On success:
   - clear `lastError`
   - update `lastSyncTime`
4. On failure:
   - set `lastError` to safe user message
   - continue to next mapping

No success notices are emitted.

## 6. Safety and Conflict Handling

Scheduled pull reuses existing safeguards in `gitService.pull`:
- canonical path/repo-root checks
- in-progress merge/rebase/cherry-pick detection
- branch mismatch handling
- safe error mapping/sanitization

If repo is dirty/conflicted/in wrong state:
- pull is skipped by existing guard path and `lastError` is updated (user-approved behavior).

## 7. Interaction With Existing Auto-Sync

No behavior change to existing `AutoSyncManager`:
- Existing file-event auto-sync remains commit+sync logic.
- New scheduled pull-only manager is independent.
- Both managers share `SyncManager`, so per-repo serialization/backoff is preserved.

## 8. Error Handling and Observability

- Scheduled pull manager logs warnings via existing sanitized logger.
- UI-facing error channel remains mapping `lastError` shown in status/diagnostics.
- No hidden retries outside existing queue/backoff policy.

## 9. Testing Strategy

Unit tests (new):
- Feature disabled when toggle off.
- Feature disabled when interval is 0.
- Startup immediate cycle runs when enabled.
- Settings change triggers immediate cycle and timer reset.
- No overlapping cycle execution (`running` guard).
- Per-mapping failures do not abort cycle.
- Success updates `lastSyncTime`; failures update `lastError`.
- Queue/backoff integration honored via `SyncManager`.

Regression checks:
- Existing auto-sync tests remain unchanged and pass.
- Existing manual pull/push/sync command paths remain unchanged.

## 10. Risks and Mitigations

Risk: frequent intervals may create unnecessary network pressure.  
Mitigation: conservative default (`86400`), existing backoff, and explicit user control.

Risk: confusion between auto-sync and scheduled pull-only features.  
Mitigation: explicit settings copy and README note distinguishing the two.

## 11. Implementation Scope

In scope:
- settings fields + defaults + normalization
- settings UI controls
- new `PeriodicPullManager`
- `main.ts` wiring and settings-change hook
- tests for new manager behavior
- docs updates for feature description

Out of scope:
- branch switching UX
- remote polling without pull
- notifications/toasts on success

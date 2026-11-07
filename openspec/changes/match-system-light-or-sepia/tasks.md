## 1. Theme preference and resolution

- [ ] 1.1 Add the validated Light/Sepia browser preference, shared-store hook/setter, guarded persistence, reset handling, and storage-event synchronization in `src/lib/theme.ts`; verify unit tests cover missing/invalid values, blocked storage, tab updates, and storage clearing.
- [ ] 1.2 Extend runtime resolution and the inline initialization script to use the light-side preference while preserving existing manual values; verify theme tests cover all manual/system choices against both OS modes and both light-side preferences, including color-scheme and theme-color metadata.

## 2. Appearance controls

- [ ] 2.1 Add the conditional Light appearance radio group and explanatory text in Appearance, retaining manual card/header behavior and freeze-on-disable semantics; verify settings/component tests cover preference changes in light and dark OS modes, manual overrides, and restoration of the remembered pairing.
- [ ] 2.2 Restyle Match my system using a native checkbox, warm theme tokens, amber checked state, checkmark, visible focus, and a 44px label target; verify keyboard and label activation and inspect checked, unchecked, focused, and forced-colors states across Light, Sepia, and Dark at desktop and mobile widths.

## 3. Integration verification

- [ ] 3.1 Extend `e2e/theme.spec.ts` to verify saved system Sepia from the first frame, reload/navigation persistence, live Sepia/Dark transitions, and the unchanged default Light/Dark pairing; run `pnpm exec playwright test e2e/theme.spec.ts` successfully with the project's required test environment.
- [ ] 3.2 Run the affected theme, settings, and header component unit tests, `pnpm typecheck`, and `pnpm exec biome check` on changed source/test files; resolve failures and confirm only intended theme behavior changed.

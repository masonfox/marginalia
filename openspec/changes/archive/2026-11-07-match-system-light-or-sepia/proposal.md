## Why

Readers who prefer sepia currently have to give up automatic system theme switching. Issue [#48](https://github.com/masonfox/marginalia/issues/48) asks for a configurable light-side theme and a Match my system checkbox that fits Marginalia's visual identity.

## What Changes

- Let readers choose Light or Sepia as the daytime theme while Match my system is enabled; the dark-side theme remains Dark.
- Remember that preference in the browser, apply it before first paint, and respond to live system preference changes.
- Preserve existing manual theme choices and the default Light/Dark system pairing.
- Restyle the Match my system checkbox with the existing warm surfaces, amber selection, and visible keyboard focus.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `visual-theme`: Extend theme persistence and system matching with a remembered Light/Sepia preference and accessible, branded appearance controls.

## Impact

- Theme resolution, browser persistence, subscriptions, and inline initialization in `src/lib/theme.ts`.
- Appearance controls in `src/routes/settings.tsx`; preserve manual header behavior in `src/components/theme-switch.tsx`.
- Theme unit tests, settings/component tests, and first-frame/system-switching browser coverage.
- No server settings, database migration, new dependency, or theme palette changes.

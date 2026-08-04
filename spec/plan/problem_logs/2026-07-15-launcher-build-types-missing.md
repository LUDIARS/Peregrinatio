# Peregrinatio launcher build failed with missing Vite type definitions

- Date: 2026-07-15
- Status: regressed and repaired on 2026-07-19
- Area: Excubitor launch / web build dependencies
- Severity: medium — automatic launch failed, later manual launch succeeded

## Summary

Peregrinatio did not start from the 2026-07-15 20:00 launcher run because Excubitor's
pre-launch `npm run build:web` failed before the service process was spawned. Required
Vite/PWA type definition files were absent from `node_modules` at that time.

Dependencies were present by 21:13, and a later Excubitor start completed. The service is
currently listening and serves HTTP 200.

## Evidence

- Excubitor audit entry at 2026-07-15 20:00:39 +09:00 records `service.start` failure,
  exit code 2, command `npm run build:web`.
- TypeScript reported `TS2688` for both `vite-plugin-pwa/client` and `vite/client`.
- The corresponding installed files currently have creation time
  2026-07-15 21:13:30 +09:00.
- Excubitor audit entry at 2026-07-15 21:25:20 +09:00 records a successful spawn.
- `logs/start-server.log` shows a successful build, zero pending migrations, and
  `Peregrinatio server on http://127.0.0.1:8090`.
- A direct HTTP check after launch returned status 200.

## Regression Context

The package declarations and lockfiles are unchanged. The failure was caused by an
incomplete/missing local dependency installation, not a committed TypeScript source error.

On 2026-07-19 this dependency-installation failure recurred after the itinerary-notes merge.
`npm run build:web` completed TypeScript compilation and Vite bundling, then failed during
PWA generation because `node_modules` did not contain `@apideck/better-ajv-errors`, which is
required by `workbox-build`. `npm config get omit` still returned `dev`.

## Cause

The automatic launcher invokes the catalog `build_command` before spawn. At 20:00 the
workspace's installed dependencies did not contain the Vite and vite-plugin-pwa type
entries required by `apps/web/tsconfig.json`, so the launch stopped at the build gate.

The host npm configuration reports `omit=dev`. Consequently, plain `npm ci` and
`npm update` omit the Vite/PWA devDependencies even though the production start path
executes the web build. `npm ci --include=dev` is required in this environment.

The start path also builds the web app again inside `start-peregrinatio.bat`, causing a
successful start to take substantially longer than a simple process spawn and encouraging
duplicate start attempts.

## Fix Requirements

- Ensure dependencies are installed/validated before the launcher attempts the build.
- Avoid duplicating `build:web` in both Excubitor's `build_command` and the start script.
- Surface build progress and the exact TypeScript failure in the launcher UI.

## Verification

- Reinstalled the primary checkout with `npm ci --include=dev`.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- Workspace tests: 132 passed across server, web, crawl, and llm packages; packages with
  no tests exited successfully under `--passWithNoTests`.
- The declared web build completed successfully with Vite 7.3.6 and PWA artifacts.
- Stopped and started only through Excubitor under Concordia testing claim #34.
- HTTP readiness returned status 200 on probe attempt 4.

### 2026-07-19 recurrence

- The first `npm ci --include=dev` attempt failed with `EPERM` because the running
  Peregrinatio process held `node_modules/@esbuild/win32-x64/esbuild.exe` open.
- Stopped Peregrinatio through Excubitor under Concordia testing claim #78, then reran
  `npm ci --include=dev`; 510 packages were installed successfully.
- `npm run build:web` completed PWA generation, including `sw.js` and the Workbox bundle.
- Web tests: 12 passed. Targeted schedule API tests: 11 passed.

## Follow-up

The current service is healthy. A broad `npm update --include=dev` could not query the
private `@ludiars/encrypted-config` package because the configured GitHub Packages token
returned HTTP 401; the lockfile-based clean install, audit, tests, build, and startup all
succeeded, and no package file diff was produced for Peregrinatio.

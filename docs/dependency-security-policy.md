# Dependency security policy

## Automated gates

CI runs `npm run audit:runtime` and `npm run audit:tooling` after `npm ci`.

- Runtime dependencies fail at moderate severity or higher.
- The complete toolchain fails at high severity or higher.
- Registry and transport failures are failures, not clean audit results.
- A zero advisory count does not establish absence of vulnerabilities or exploitability.

## Current development-only exception

Owner: repository maintainer. Review deadline: 2026-12-01.

The patched Vite 7, Vitest 4, PostCSS 8, ESLint 9, and typescript-eslint 8 graph has no reported high or critical findings at the implementation audit. Twelve moderate package entries trace to the minimatch globparts amplification advisory, GHSA-g3hv-75wg-m249. This is one advisory family propagated through multiple lint packages, not twelve distinct CVEs. It affects development tooling, not the browser runtime dependency graph.

Disposition: temporarily retain upstream-compatible minimatch dependency ranges. Do not force minimatch 11 into packages expecting versions 3 or 10 solely to hide the advisory. ESLint and its plugins run only on trusted repository inputs in local development or unprivileged pull-request CI. CI does not expose a lint service and does not supply deployment secrets to pull-request jobs. Do not run these tools on untrusted repositories with privileged credentials.

This is a bounded development-tool exception, not a general acceptance of future moderate findings. Recheck `npm audit --json` before release and at the deadline. Upgrade upstream packages when compatible fixes are available. Any newly introduced advisory, broader attack condition, or overdue exception requires maintainer review. High/critical findings block qualification unless the owner explicitly changes this policy with evidence.

## Version support

Node 24 is the CI target. Node 26 is also declared for the development environment used during implementation. npm 11 is required. Use the committed lockfile and verify `npm ci` in an isolated checkout after any toolchain change.

# Security Policy

## Reporting a vulnerability

Report suspected vulnerabilities in `sil-openclaw` **privately — do not open a
public issue**. Contact [@4gpts on X](https://x.com/4gpts) (this mirrors
`openclaw.plugin.json#security.reportVulnerabilitiesTo`). We aim to acknowledge
within a few business days and will coordinate a fix and disclosure timeline.

## Supported versions

Only the latest `sil-openclaw` published to npm / ClawHub is supported. We do not
backport fixes or maintain old release lines — upgrade to the latest version.

## What this plugin touches

`register()` opens nothing — all I/O happens inside a tool's `execute()`. The
plugin talks only to its two configured sil origins (`sil_web_url` for auth /
token refresh, `sil_api_url` for identity + catalog reads) and stores
credentials owner-only (`0600`) under the sil data directory. The PKCE verifier
is held only in memory and never written to disk; tokens and identity PII are
never logged.

The authoritative, machine-readable disclosure ships in the package manifest —
`openclaw.plugin.json#security` — covering network endpoints, filesystem scope,
credentials on disk, and the `noNativeModules` / `noChildProcess` /
`noInstallScripts` guarantees. Review it before installing.

# Security Policy

## Reporting a vulnerability

Report suspected vulnerabilities in `sil-openclaw` **privately — do not open a
public issue**. Contact [@4gpts on X](https://x.com/4gpts). We aim to acknowledge
within a few business days and will coordinate a fix and disclosure timeline.

## Supported versions

Only the latest `sil-openclaw` published to npm / ClawHub is supported. We do not
backport fixes or maintain old release lines — upgrade to the latest version.

## What this plugin touches

Compiled JavaScript ships under `./dist`. No native modules, no install scripts,
no long-lived service, no inbound HTTP route.

**`register()` opens nothing.** It registers the tools and one gateway method,
ensures the data directory, and synchronously reads the tool request schemas
under `./schema` — tracked files inside the package. No network, timer or handle.
All network I/O happens inside a tool's `execute()`.

### Network endpoints

The plugin talks to these hosts and no others:

- `https://sil.4gpts.com` — sil-web: registration and token refresh (`sil_web_url`).
- `https://sil-api.4gpts.com` — sil-api: identity, catalog, brief and profile (`sil_api_url`).
- `https://clawhub.ai` — one unauthenticated, read-only `GET` by `sil_doctor` of
  the published `@4gpts/sil` version: no token, no PII, bounded timeout, redirects
  refused, silent on any failure.

The `shopping_*` tools are read-only, except `shopping_domain_create` (writes one
registry row) and `shopping_brief_create` / `shopping_brief_edit` /
`shopping_profile_edit` (write the buyer's own brief and profile under their sil
account). On a `401`, every sil call refreshes once and retries once. A second
`401` or a dead refresh token clears `tokens.json`.

### Filesystem and credentials

Everything lives under `$SIL_DATA_DIR` (default `$XDG_DATA_HOME/sil`, else
`~/.local/share/sil`), owner-only (files `0600`, dirs `0700`), written atomically
(tmp → rename → chmod):

- `tokens.json` — access and refresh token.
- `config.json` — user identity.

Nothing of the buyer's is kept on disk, and no caller-supplied value ever becomes
a path segment. The PKCE verifier stays in memory. Tokens and identity PII are
never logged.

`sil_doctor` reads that directory's state and metadata. It decodes only the
access token's `exp` claim, locally, and never emits token bytes. It only ever
narrows a too-open mode and creates a missing data directory. To prove the
directory is writable it writes one empty `.doctor.<hex>.tmp` probe and unlinks
it. Anything that would change an existing file's bytes is reported, never run.
Symlinks inside the directory are reported, never chmod'd through.

### Timers and processes

`sil_register` arms one bounded poll timer. It stops on the first terminal claim
outcome or at the session deadline. Any other timer is scoped to one call.

The plugin process spawns nothing. The shipped `scripts/allowlist-openclaw.mjs`
is operator-run, never a lifecycle hook. It calls the host's `openclaw config
validate` CLI and writes the host `openclaw.json` (with a `.bak`) to admit sil's
tools.

### Gateway method

`sil.search_results` (scope `operator.read`, authorized by the host before the
handler runs) lets a paired client read back a `shopping_search` page by the
`callId` it saw. Pages live in an in-memory buffer: at most 32 of them, each
dropped 15 minutes after its search, never written to disk. A page is served only
to the sil account that produced it. An unknown, expired or foreign reference gets
one identical not-found body. No network call, no agent run.

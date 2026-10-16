/**
 * Host half of `dsh-checkup`.
 *
 * This plugin's value is entirely on the client (renderer) side: the slots
 * ledger and the in-UI alert surface (`shell.overlay`, `settings.section`)
 * both live in the web client cordis tree. The host half therefore only needs
 * to exist so the Loader has a row and the cordis patch `insert` resolves.
 *
 * Extension point (not in this client-only build): a host companion could
 * `inject: ['tools']` and read `ctx.tools.layers` / `ctx.tools.view()` to
 * catch *host-side* tool-registration overrides that the renderer never sees,
 * then expose a `health` remote consumed by the client half below.
 *
 * @type {{apply?: () => void}}
 */
export function apply() {}

/**
 * Shared test harness: boots a real cordis Context with a minimal
 * `systemPrompt` stub and the real `dsh-tools` ToolRuntime, straight out of the
 * installed DSH archive. Run with Electron-as-node:
 *
 *   $env:ELECTRON_RUN_AS_NODE=1
 *   & "D:\ProgramFiles\DeepSeek Harness\DeepSeek Harness.exe" test/xxx.mjs
 */
const DSH_NODE_MODULES =
  'file:///D:/ProgramFiles/DeepSeek%20Harness/resources/app.asar/dsh/node_modules'

export const cordis = await import(`${DSH_NODE_MODULES}/@deepseek-ai/cordis/lib/index.js`)
export const tools = await import(`${DSH_NODE_MODULES}/@deepseek-ai/dsh-tools/lib/index.js`)
export const scope = await import(`${DSH_NODE_MODULES}/@deepseek-ai/dsh-scope/lib/index.js`)

export const { Context, Service } = cordis
export const { defineTool, ToolRuntime } = tools

/** Minimal stand-in for @deepseek-ai/dsh-system-prompt (native mode needs only `tools()`). */
export class FakeSystemPrompt extends Service {
  static inject = []
  constructor(ctx) {
    super(ctx, 'systemPrompt')
    this._tools = []
  }
  tools(callback) {
    this._tools.push(callback)
    return () => {}
  }
  section(registration) {
    this._sections ??= []
    this._sections.push(registration)
    return () => {}
  }
  getSectionOrder(name) {
    return 0
  }
}

/** Build a tool definition good enough for `ToolRuntime.register` validation. */
export function fakeTool(name, extra = {}) {
  return {
    name,
    description: `fake tool ${name}`,
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute() {
      return name
    },
    ...extra,
  }
}

/** Cordis applies plugins on later turns; drain the microtask/immediate queue. */
export async function settle(turns = 6) {
  for (let index = 0; index < turns; index += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

/**
 * Boot a registry context.
 * @returns {Promise<{ ctx: object, runtime: object, raw: object, dispose: () => Promise<void> }>}
 */
export async function boot() {
  const ctx = new Context()
  ctx.plugin(FakeSystemPrompt)
  await settle()
  ctx.plugin(ToolRuntime, { mode: 'native' })
  await settle()
  const raw = ctx.tools[Symbol.for('cordis.original')]
  return {
    ctx,
    runtime: ctx.tools,
    raw,
    dispose: () => ctx.fiber.dispose(),
  }
}

/** Define a named fake plugin that registers tools through its own context. */
export function pluginThatRegisters(name, registrations) {
  return {
    name,
    apply(ctx) {
      for (const definition of registrations) ctx.tools.register(definition)
    },
  }
}

let failures = 0
let checks = 0
export function check(label, condition, detail = '') {
  checks += 1
  if (condition) {
    console.log(`  PASS  ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
export function report() {
  console.log(`\n${checks - failures}/${checks} checks passed`)
  return failures === 0
}

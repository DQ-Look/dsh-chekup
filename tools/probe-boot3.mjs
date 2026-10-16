import { Context, Service, ToolRuntime } from './cordis-harness.mjs'

class FakeSystemPrompt extends Service {
  constructor(ctx) {
    super(ctx, 'systemPrompt')
  }
  tools() {
    return () => {}
  }
}

const settle = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve))
}

const ctx = new Context()
ctx.plugin(FakeSystemPrompt)
await settle()
console.log('systemPrompt =', typeof ctx.systemPrompt)
const fiber = ctx.plugin(ToolRuntime, { mode: 'native' })
await settle()
console.log('fiber state =', fiber.state, 'tools =', typeof ctx.tools)
if (ctx.tools) {
  const raw = ctx.tools[Symbol.for('cordis.original')]
  console.log('raw =', typeof raw, 'layers =', raw && typeof raw.layers)
  console.log('proto methods =', Object.getOwnPropertyNames(Object.getPrototypeOf(raw)).join(','))
}
console.log('reflect store =', Reflect.ownKeys(ctx.reflect.store).map(String).join(','))
await ctx.fiber.dispose()

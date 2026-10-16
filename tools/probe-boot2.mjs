import { Context, Service, ToolRuntime } from './cordis-harness.mjs'

class FakeSystemPrompt extends Service {
  constructor(ctx) {
    super(ctx, 'systemPrompt')
    ctx.reflect.provide('systemPrompt', this)
  }
  tools() {
    return () => {}
  }
}

const ctx = new Context()
ctx.plugin(FakeSystemPrompt)
await ctx.fiber.inertia
const fiber = ctx.plugin(ToolRuntime, { mode: 'native' })
console.log('fiber state =', fiber.state, 'runtime =', fiber.runtime && fiber.runtime.name)
await fiber.inertia
console.log('after inertia state =', fiber.state, 'tools =', typeof ctx.tools)
console.log('reflect store =', Reflect.ownKeys(ctx.reflect.store).map(String).join(','))
const pending = fiber._store
console.log('_store =', pending && Object.keys(pending).join(','), 'inject =', Object.keys(fiber.inject).join(','))
console.log('store(fiber) =', fiber.store && Object.keys(fiber.store).join(','))
try {
  const t = ctx.reflect.get('tools', true)
  console.log('strict get tools =', typeof t)
} catch (e) {
  console.log('strict get threw:', e.message)
}
await ctx.fiber.dispose()

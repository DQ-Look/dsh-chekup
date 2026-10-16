import { Context, Service, ToolRuntime } from './cordis-harness.mjs'

class FakeSystemPrompt extends Service {
  constructor(ctx) {
    super(ctx, 'systemPrompt')
  }
}

const ctx = new Context()
console.log('root fiber:', ctx.fiber && ctx.fiber.constructor.name, 'inertia:', String(ctx.fiber.inertia))
const r1 = ctx.plugin(FakeSystemPrompt)
console.log('plugin() ->', typeof r1, r1 && r1.constructor && r1.constructor.name)
await ctx.fiber.inertia
console.log('after inertia, systemPrompt =', typeof ctx.systemPrompt)
const r2 = ctx.plugin(ToolRuntime, { mode: 'native' })
console.log('plugin2 ->', r2 && r2.constructor && r2.constructor.name)
await ctx.fiber.inertia
console.log('tools =', typeof ctx.tools)
console.log('r2.inertia =', String(r2 && r2.inertia))
if (r2 && r2.inertia) await r2.inertia
console.log('after r2.inertia, tools =', typeof ctx.tools)
console.log('reflect store keys =', Reflect.ownKeys(ctx.reflect.store).map(String).join(','))
console.log('reflect get tools =', typeof ctx.reflect.get('tools', false))
await ctx.fiber.dispose()

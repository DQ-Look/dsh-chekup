import { boot, settle, pluginThatRegisters, fakeTool } from './cordis-harness.mjs'

const ORIGINAL = Symbol.for('cordis.original')
const SCOPE = Symbol.for('dsh.scope')

const { ctx, runtime, raw, dispose } = await boot()
console.log('booted. layers.global tools =', [...raw.layers.global.tools.keys()].join(',') || '(none)')

// --- patch the registry prototype to capture the registering context ---------
const proto = Object.getPrototypeOf(raw)
const originalRegister = proto.register
const log = []
proto.register = function (definition) {
  const caller = this.ctx
  log.push({
    name: definition.name,
    plugin: caller?.fiber?.runtime?.name ?? caller?.fiber?.name ?? '(unknown)',
    fiberName: caller?.fiber?.name,
    hasScope: caller ? Object.getOwnPropertySymbols(caller).map(String) : [],
  })
  return originalRegister.call(this, definition)
}

ctx.plugin(pluginThatRegisters('plugin-a', [fakeTool('alpha'), fakeTool('beta')]))
ctx.plugin(pluginThatRegisters('plugin-b', [fakeTool('gamma')]))
await settle()

console.log('\nattribution log:')
for (const row of log) console.log(' ', JSON.stringify(row))
console.log('\nglobal layer tools:', [...raw.layers.global.tools.keys()].join(','))
console.log('scoped layers:', raw.layers.scoped.size)

// --- duplicate global name: what happens? -----------------------------------
let duplicateError = null
try {
  ctx.plugin(pluginThatRegisters('plugin-c', [fakeTool('alpha')]))
  await settle()
} catch (error) {
  duplicateError = error.message
}
console.log('\nduplicate global register error:', duplicateError)
console.log('global layer tools after duplicate:', [...raw.layers.global.tools.keys()].join(','))

// --- scoped (agent-plane) registration shadowing a global ------------------
const scopedContext = ctx.extend({ [SCOPE]: { label: 'agent-demo' } })
scopedContext.tools.register(fakeTool('alpha', { description: 'scoped override of alpha' }))
await settle()
console.log('\nafter scoped register: scoped layers =', raw.layers.scoped.size)
const scopedLayer = [...raw.layers.scoped.values()][0]
console.log('scoped layer tools:', scopedLayer ? [...scopedLayer.tools.keys()].join(',') : '(none)')

// does the global 'alpha' definition differ from the scoped one now?
const globalAlpha = raw.layers.global.tools.get('alpha')
const scopedAlpha = scopedLayer?.tools.get('alpha')
console.log('global alpha === scoped alpha ?', globalAlpha === scopedAlpha)
console.log('raw.layers.merge observed for that scope sees alpha from:',
  raw.layers.merge([...raw.layers.scoped.keys()][0], (l) => l.tools).get('alpha') === scopedAlpha ? 'scoped' : 'global')

// --- visibility / restriction ----------------------------------------------
console.log('\nschemas (global view):', runtime.schemas().map((s) => s.name).join(','))

await dispose()

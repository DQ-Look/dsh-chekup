// Probe runtime availability of things the plugin will rely on inside the host.
try {
  const yaml = require('yaml')
  console.log('require("yaml"):', typeof yaml, typeof yaml.parseDocument)
} catch (error) {
  console.log('require("yaml") FAILED:', error.message)
}
try {
  const p = require.resolve('@deepseek-ai/dsh-session/package.json')
  console.log('resolve @deepseek-ai/dsh-session/package.json ->', p)
} catch (error) {
  console.log('resolve dsh-session FAILED:', error.message)
}
try {
  const p = require.resolve('dsh-plugin/package.json')
  console.log('resolve dsh-plugin/package.json ->', p)
} catch (error) {
  console.log('resolve dsh-plugin FAILED:', error.message)
}

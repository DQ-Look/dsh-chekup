// Probe: can Electron-as-node import modules out of app.asar?
const ASAR = 'file:///D:/ProgramFiles/DeepSeek%20Harness/resources/app.asar/dsh/node_modules'
try {
  const cordis = await import(`${ASAR}/@deepseek-ai/cordis/lib/index.js`)
  const ctx = new cordis.Context()
  console.log('cordis OK; keys =', Object.keys(cordis).slice(0, 20).join(','))
  const tools = await import(`${ASAR}/@deepseek-ai/dsh-tools/lib/index.js`)
  console.log('dsh-tools OK; keys =', Object.keys(tools).join(','))
} catch (error) {
  console.log('FAILED:', error.message)
}

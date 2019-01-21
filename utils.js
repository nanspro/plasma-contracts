const util = require('util')
const exec = util.promisify(require('child_process').exec)

// Helper functions for compiling the Vyper contracts
async function compileVyper (path) {
  const bytecodeOutput = await exec('vyper ' + path + ' -f bytecode')
  const abiOutput = await exec('vyper ' + path + ' -f abi')
  // Return both of the output's stdout without the last character which is \n
  return [ bytecodeOutput.stdout.slice(0, -1), abiOutput.stdout.slice(0, -1) ]
}

async function compilePlasmaChainContract () {
  return compileVyper('./contracts/PlasmaChain.vy')
}

async function compilePlasmaRegistryContract () {
  return compileVyper('./contracts/PlasmaRegistry.vy')
}

module.exports = {
  contracts: {
    compileVyper,
    compilePlasmaChainContract,
    compilePlasmaRegistryContract
  }
}

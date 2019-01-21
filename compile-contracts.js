const fs = require('fs')
const compilePlasmaChainContract = require('./utils.js').contracts.compilePlasmaChainContract
const compilePlasmaRegistryContract = require('./utils.js').contracts.compilePlasmaRegistryContract

async function compileContracts () {
  let plasmaChainBytecode, plasmaChainAbi, plasmaRegistryBytecode, plasmaRegistryAbi
  [plasmaChainBytecode, plasmaChainAbi] = await compilePlasmaChainContract();
  [plasmaRegistryBytecode, plasmaRegistryAbi] = await compilePlasmaRegistryContract()

  // Create JS file for easy imports of the Plasma chain binary & abi
  const plasmaChainJS = `
module.exports = {
  bytecode: '${plasmaChainBytecode}',
  abi: JSON.parse('${plasmaChainAbi}')
}
`
  const plasmaRegistryJS = `
module.exports = {
  bytecode: '${plasmaRegistryBytecode}',
  abi: JSON.parse('${plasmaRegistryAbi}')
}
`
  console.log('Compiled contracts! Saving them to ./compiled-contracts')
  fs.writeFileSync('compiled-contracts/plasma-chain.js', plasmaChainJS)
  fs.writeFileSync('compiled-contracts/plasma-registry.js', plasmaRegistryJS)
}

module.exports = {
  compileContracts: compileContracts
}

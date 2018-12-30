/* eslint-env mocha */
/* eslint-disable no-unused-expressions */

const util = require('util')
const exec = util.promisify(require('child_process').exec)
const log = require('debug')('info:plasma-contract')
const ganache = require('ganache-cli')
const Web3 = require('web3')
const web3 = new Web3(ganache.provider())
const chai = require('chai')
const expect = chai.expect

async function compileVyper (path) {
  const bytecodeOutput = await exec('vyper ' + path + ' -f bytecode')
  const abiOutput = await exec('vyper ' + path + ' -f abi')
  // Return both of the output's stdout without the last character which is \n
  return [bytecodeOutput.stdout.slice(0, -1), abiOutput.stdout.slice(0, -1)]
}

describe('Plasma', function () {
  it('Should compile the vyper contract without errors', async () => {
    const [bytecode, abi] = await compileVyper('./contracts/plasmaprime.vy')
    log('Bytecode: ', bytecode.slice(0, 300), '...\n ABI: ', abi.slice(0, 300), '...')
    expect(abi).to.exist
    expect(bytecode).to.exist
    expect(web3).to.exist
  })
})

/* eslint-env mocha */
/* eslint-disable no-unused-expressions */

const util = require('util')
const exec = util.promisify(require('child_process').exec)
const log = require('debug')('info:plasma-contract')
const ganache = require('ganache-cli')
const Web3 = require('web3')
const chai = require('chai')
const expect = chai.expect
// const encoder = require('plasma-utils').encoder

// SETUP WEB3 AND GANACHE
const web3 = new Web3()
const ganacheAccounts = []
for (let i = 0; i < 5; i++) {
  const privateKey = Web3.utils.sha3(i.toString())
  ganacheAccounts.push({
    balance: '0x99999999991',
    secretKey: privateKey
  })
  web3.eth.accounts.wallet.add(privateKey)
}
// For all provider options, see: https://github.com/trufflesuite/ganache-cli#library
const providerOptions = {'accounts': ganacheAccounts, 'locked': true}
web3.setProvider(ganache.provider(providerOptions))

async function compileVyper (path) {
  const bytecodeOutput = await exec('vyper ' + path + ' -f bytecode')
  const abiOutput = await exec('vyper ' + path + ' -f abi')
  // Return both of the output's stdout without the last character which is \n
  return [bytecodeOutput.stdout.slice(0, -1), abiOutput.stdout.slice(0, -1)]
}

async function mineBlock () {
  return new Promise((resolve, reject) => {
    web3.currentProvider.sendAsync({
      jsonrpc: '2.0',
      method: 'evm_mine',
      id: new Date().getTime()
    }, function (err, result) {
      if (err) {
        reject(err)
      }
      resolve(result)
    })
  })
}

describe('Plasma', () => {
  it('Should compile the vyper contract without errors', async () => {
    const [bytecode, abi] = await compileVyper('./contracts/plasmaprime.vy')
    log('Bytecode: ', bytecode.slice(0, 300), '...\n ABI: ', abi.slice(0, 300), '...')
    expect(abi).to.exist
    expect(bytecode).to.exist
    expect(web3).to.exist
    expect(ganache).to.exist
    // const balance = await web3.eth.getBalance(accounts[0].address)
    const bn = await web3.eth.getBlockNumber()
    await mineBlock()
    const bn2 = await web3.eth.getBlockNumber()
    log(bn)
    log(bn2)
    // Now try to deploy
    const addr = web3.eth.accounts.wallet[0].address
    const plasmaCt = new web3.eth.Contract(JSON.parse(abi))
    const plasma = plasmaCt.deploy({ from: addr, data: bytecode })
    console.log(plasma)
    // const res = await plasma.methods.plasmaMessageHash(addr, addr, 100, 10).send({ from: addr })
  })
})

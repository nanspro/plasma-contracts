/* eslint-env mocha */
/* eslint-disable no-unused-expressions */

const util = require('util')
const exec = util.promisify(require('child_process').exec)
const log = require('debug')('info:plasma-contract')
const ganache = require('ganache-cli')
const Web3 = require('web3')
const BN = Web3.utils.BN
const chai = require('chai')
const expect = chai.expect
const assert = chai.assert

const MAX_END = new BN('170141183460469231731687303715884105727', 10) // this is not the right max end for 16 bytes, but we're gonna leave it for now as vyper has a weird bug only supporting uint128 vals
const IMAGINARY_PRECEDING = MAX_END.add(new BN(1))

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
const providerOptions = {'accounts': ganacheAccounts, 'locked': false, 'logger': console}
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

async function mineNBlocks (n) {
  for (let i = 0; i < n; i++) {
    await mineBlock()
  }
  console.log('mined ' + n + ' empty blocks')
}

async function getCurrentChainSnapshot () {
  return new Promise((resolve, reject) => {
    web3.currentProvider.sendAsync({
      jsonrpc: '2.0',
      method: 'evm_snapshot',
      id: new Date().getTime()
    }, function (err, result) {
      if (err) {
        reject(err)
      }
      resolve(result)
    })
  })
}

async function revertToChainSnapshot (snapshot) {
  return new Promise((resolve, reject) => {
    web3.currentProvider.sendAsync({
      jsonrpc: '2.0',
      method: 'evm_revert',
      id: new Date().getTime(),
      params: [snapshot.result],
      external: true
    }, function (err, result) {
      if (err) {
        console.log(err)
        reject(err)
      }
      console.log('result: ', result)
      resolve(result)
    })
  })
}

describe('Plasma', () => {
  let bytecode, abi, plasmaCt, plasma, freshContractSnapshot

  before( async () => {
   [bytecode, abi] = await compileVyper('./contracts/plasmaprime.vy')
   const addr = web3.eth.accounts.wallet[0].address

   plasmaCt = new web3.eth.Contract(JSON.parse(abi), addr, {from: addr, gas: 2500000, gasPrice: '300000'})
   // const balance = await web3.eth.getBalance(accounts[0].address)
   const bn = await web3.eth.getBlockNumber()
   await mineBlock()
   const bn2 = await web3.eth.getBlockNumber()
   log(bn)
   log(bn2)
   // Now try to deploy
   plasma = await plasmaCt.deploy({data: bytecode }).send()/*{
    from: addr,
    gas: 2500000,
    gasPrice: '300000'
  })*/
  const block = await web3.eth.getBlock('latest')
  const deploymentTransaction = await web3.eth.getTransaction(block.transactions[0])
  freshContractSnapshot = await getCurrentChainSnapshot()
  })

  it('Should compile the vyper contract without errors', async () => {
    log('Bytecode: ', bytecode.slice(0, 300), '...\n ABI: ', abi.slice(0, 300), '...')
    expect(abi).to.exist
    expect(bytecode).to.exist
    expect(plasma).to.exist
    expect(web3).to.exist
    expect(ganache).to.exist
  })
  const emptyBlockHash = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
  it('should allow a block to be published by the operator', async () => {
    await mineNBlocks(10) // blocktime is 10
    await plasma.methods.submitBlock(emptyBlockHash).send({value: 0, from: web3.eth.accounts.wallet[0].address, gas: 4000000}, async function (error, result){ //get callback from function which is your transaction key
      if(!error){
        // const receipt = await web3.eth.getTransactionReceipt(result)
      } else{
        assert.equal(true, false) // theres a better way but fuckit, need to fail tests when things don't pass
        console.log(error)
      }
    }).then(async () => {
      // depositEnd = await plasma.methods.depositedRanges__end(0).call()
      // depositNextStart = await plasma.methods.depositedRanges__nextDepositStart(0).call()
    }).catch((error) => {console.log('send callback failed: ', error)})
  })
  let bigDepositSnapshot
  it('should allow a first deposit and add it to the deposits correctly', async () => {
    let depositEnd, depositNextStart
    const depositSize = 50
    await plasma.methods.deposit(0).send({value: depositSize, from: web3.eth.accounts.wallet[1].address, gas: 4000000}, async function (error, result){ //get callback from function which is your transaction key
      if(!error){
        // let receipt = await web3.eth.getTransactionReceipt(result)
      } else{
        assert.equal(true, false) // theres a better way but fuckit, need to fail tests when things don't pass
        console.log(error)
      }
    }).catch((error) => {console.log('send callback failed: ', error)})
    depositEnd = await plasma.methods.depositedRanges__end(0).call()
    depositNextStart = await plasma.methods.depositedRanges__nextDepositStart(0).call()
    assert.deepEqual(new BN(depositEnd), new BN(depositSize))
    assert.deepEqual(new BN(depositNextStart), MAX_END)
    bigDepositSnapshot = getCurrentChainSnapshot()
  })
  it('should allow left, right, and un-aligned exits if unchallenged', async () => {
    // await mineNBlocks(10)
    // //mine a new plasma block so we can exit
    // await plasma.methods.submitBlock(emptyBlockHash).send({value: 0, from: web3.eth.accounts.wallet[0].address, gas: 4000000}, async function (error, result){ //get callback from function which is your transaction key
    //   if(!error){
    //   } else{
    //     assert.equal(true, false) // theres a better way but fuckit, need to fail tests when things don't pass
    //   }
    // }).then(async () => {}).catch((error) => {console.log('send callback failed: ', error)})

    await plasma.methods.beginExit(1, 0, 10, 0).send({value: 0, from: web3.eth.accounts.wallet[1].address, gas: 4000000})
    await plasma.methods.beginExit(1, 20, 30, 0).send({value: 0, from: web3.eth.accounts.wallet[1].address, gas: 4000000})
    await plasma.methods.beginExit(1, 40, 50, 0).send({value: 0, from: web3.eth.accounts.wallet[1].address, gas: 4000000})
    await mineNBlocks(20)

    await plasma.methods.finalizeExit(0, '0x' + IMAGINARY_PRECEDING.toString(16)).call({value: 0, from: web3.eth.accounts.wallet[1].address, gas: 4000000}, async function (error, result){
      let receipt = await web3.eth.getTransactionReceipt(result)
      let bn = await web3.eth.getBlockNumber()
      // receipt + error + bn
    })
    await plasma.methods.finalizeExit(1, 10).send({value: 0, from: web3.eth.accounts.wallet[1].address, gas: 4000000})
    let lol = await plasma.methods.finalizeExit(2, 30).call({value: 0, from: web3.eth.accounts.wallet[1].address, gas: 4000000}, async function (error, result){
      let receipt = await web3.eth.getTransactionReceipt(result)
      let bn = await web3.eth.getBlockNumber()
      // receipt + error + bn
    })
    const firstDepositEnd = await plasma.methods.depositedRanges__end(50).call()
    debugger
    lol+2

    // const firstDepositEnd = await plasma.methods.depositedRanges__end(0).call()
    const firstDepositNextStart = await plasma.methods.depositedRanges__nextDepositStart(0).call()
    const middleDepositEnd = await plasma.methods.depositedRanges__end(10).call()
    const middleDepositNextStart = await plasma.methods.depositedRanges__nextDepositStart(10).call()
    const lastDepositEnd = await plasma.methods.depositedRanges__end(30).call()
    const lastDepositNextStart = await plasma.methods.depositedRanges__nextDepositStart(30).call()
    debugger

    firstDepositEnd + firstDepositNextStart + middleDepositEnd + middleDepositNextStart + lastDepositEnd + lastDepositNextStart
    assert.deepEqual(new BN(depositEnd), new BN(depositSize))
    assert.deepEqual(new BN(depositNextStart), MAX_END)
    bigDepositSnapshot = getCurrentChainSnapshot()
    depositEnd = await plasma.methods.depositedRanges__end(0).call()
    depositNextStart = await plasma.methods.depositedRanges__nextDepositStart(0).call()
  })
})

const compilePlasmaContract = require('../index.js')
const ganache = require('ganache-cli')
const Web3 = require('web3')
const BN = Web3.utils.BN

const Transaction = require('plasma-utils').serialization.models.Transaction

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
const providerOptions = { 'accounts': ganacheAccounts, 'locked': false, 'logger': console }
web3.setProvider(ganache.provider(providerOptions))

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

async function revertToChainSnapshot (snapshot) { // eslint-disable-line no-unused-vars
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

/**
 * Returns a list of `n` sequential transactions.
 * @param {*} n Number of sequential transactions to return.
 * @return {*} A list of sequential transactions.
 */
const getSequentialTxs = (n) => {
  let txs = []
  for (let i = 0; i < n; i++) {
    txs[i] = new Transaction({
      block: 1,
      transfers: [
        {
          sender: web3.eth.accounts.wallet[0].address,
          recipient: web3.eth.accounts.wallet[1].address,
          token: 0,
          start: i * 20,
          end: (i + 0.5) * 20
        }
      ]
    })
  }
  return txs
}

let bytecode, abi, plasma, freshContractSnapshot

async function setupPlasma () {
  [bytecode, abi] = await compilePlasmaContract()
  const addr = web3.eth.accounts.wallet[0].address

  const plasmaCt = new web3.eth.Contract(JSON.parse(abi), addr, { from: addr, gas: 3500000, gasPrice: '300000' })

  await mineBlock()
  // Now try to deploy
  plasma = await plasmaCt.deploy({ data: bytecode }).send() /* {
        from: addr,
        gas: 2500000,
        gasPrice: '300000'
    })
    */
  // const block = await web3.eth.getBlock('latest')
  // const deploymentTransaction = await web3.eth.getTransaction(block.transactions[0]) // eslint-disable-line no-unused-vars
  freshContractSnapshot = await getCurrentChainSnapshot()
  return [bytecode, abi, plasma, freshContractSnapshot]
}

function get () {
  return [bytecode, abi, plasma, freshContractSnapshot]
}

module.exports = {
  getCurrentChainSnapshot,
  revertToChainSnapshot,
  MAX_END,
  IMAGINARY_PRECEDING,
  web3,
  mineBlock,
  mineNBlocks,
  getSequentialTxs,
  setupPlasma,
  get
}

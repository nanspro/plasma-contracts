/* eslint-env mocha */
/* eslint-disable no-unused-expressions */
const chai = require('chai')
const expect = chai.expect // eslint-disable-line no-unused-vars
const assert = chai.assert

const Web3 = require('web3')
const BN = Web3.utils.BN

const plasmaUtils = require('plasma-utils')
const PlasmaMerkleSumTree = plasmaUtils.PlasmaMerkleSumTree
const setup = require('./setup-plasma')

describe('Plasma Initialization', () => {
  let bytecode, abi, plasma, txs, tree, freshContractSnapshot // eslint-disable-line no-unused-vars
  before(async () => {
    [
      bytecode, abi, plasma, freshContractSnapshot
    ] = await setup.setupPlasma()

    txs = setup.getSequentialTxs(32)
    tree = new PlasmaMerkleSumTree(txs)
  })
  it('should getLeafHash of an encoded transaction', async () => {
    const index = Math.floor(Math.random() * 32)
    const tx = txs[index]
    const possibleHash = await plasma.methods.getLeafHash('0x' + tx.encoded).call()
    assert.equal(possibleHash, '0x' + tree.levels[0][index].hash)
  })
  it('should decodeBlockNumber from a tx', async () => {
    // todo make this not 0 to improve testing coverage lol
    const index = Math.floor(Math.random() * 32)
    const tx = txs[index]
    const possibleBN = await plasma.methods.decodeBlockNumber('0x' + tx.encoded).call()
    assert.equal(possibleBN, new BN(tx.args.transfer.block).toString())
  })
  it('should decode transferBounds from a tx', async () => {
    const index = Math.floor(Math.random() * 32)
    const tx = txs[index]
    const possibleBounds = await plasma.methods.decodeIthTransferBounds(0, '0x' + tx.encoded).call()
    assert.equal(possibleBounds[0], new BN(tx.args.transfer.start).toString())
    assert.equal(possibleBounds[1], new BN(tx.args.transfer.end).toString())
  })
  it('should decode transferFrom from a tx', async () => {
    // todo make this not 0 address to improve testing coverage
    const index = Math.floor(Math.random() * 32)
    const tx = txs[index]
    const possibleFrom = await plasma.methods.decodeIthTransferFrom(0, '0x' + tx.encoded).call()
    assert.equal(possibleFrom, tx.args.transfer.sender)
  })
  it('should decode transferTo from a tx', async () => {
    const index = Math.floor(Math.random() * 32)
    const tx = txs[index]
    const encoding = '0x' + tx.encoded
    const possibleTo = await plasma.methods.decodeIthTransferTo(0, encoding).call()
    assert.equal(possibleTo, tx.args.transfer.recipient)
  })
})

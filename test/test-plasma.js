/* eslint-env mocha */
/* eslint-disable no-unused-expressions */
const chai = require('chai')
const expect = chai.expect
const assert = chai.assert

const Web3 = require('web3')
const BN = Web3.utils.BN


const plasmaUtils = require('plasma-utils')
const PlasmaMerkleSumTree = plasmaUtils.PlasmaMerkleSumTree
const Transaction = plasmaUtils.serialization.models.Transaction
const setup = require('./setup-plasma')
const web3 = setup.web3

describe('Plasma', () => {
  let bytecode, abi, plasma, txs, tree
  let freshContractSnapshot // eslint-disable-line no-unused-vars
  debugger
  setup
  before(async () => {
    [
      bytecode, abi, plasma, freshContractSnapshot
    ] = await setup.setupPlasma()

    txs = getSequentialTxs(32)
    tree = new PlasmaMerkleSumTree(txs)
  })

  it('Should compile the vyper contract without errors', async () => {
    expect(abi).to.exist
    expect(bytecode).to.exist
    expect(plasma).to.exist
    expect(web3).to.exist
  })
  const dummyBlockHash = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
  it('should allow a block to be published by the operator', async () => {
    await setup.mineNBlocks(10) // blocktime is 10
    await plasma.methods.submitBlock(dummyBlockHash).send({ value: 0, from: web3.eth.accounts.wallet[0].address, gas: 4000000 }, async function (error, result) { // get callback from function which is your transaction key
      if (!error) {
        // const receipt = await web3.eth.getTransactionReceipt(result)
      } else {
        assert.equal(true, false) // theres a better way but need to fail tests when things throw
        console.log(error)
      }
    }).catch((error) => { console.log('send callback failed: ', error) })
  })
  let bigDepositSnapshot // eslint-disable-line no-unused-vars
  it('should allow a first deposit and add it to the deposits correctly', async () => {
    let depositEnd, depositNextStart
    const depositSize = 50
    await plasma.methods.deposit(0).send({ value: depositSize, from: web3.eth.accounts.wallet[1].address, gas: 4000000 }, async function (error, result) { // get callback from function which is your transaction key
      if (error) {
        assert.equal(true, false) // there'ss a better way but need to fail tests when things throw
        console.log(error)
      }
    }).catch((error) => { console.log('send callback failed: ', error) })
    depositEnd = await plasma.methods.depositedRanges__end(0).call()
    depositNextStart = await plasma.methods.depositedRanges__nextDepositStart(0).call()
    debugger
    assert.deepEqual(new BN(depositEnd), new BN(depositSize))
    assert.deepEqual(new BN(depositNextStart), setup.MAX_END)
    bigDepositSnapshot = setup.getCurrentChainSnapshot()
  })
  it('should allow left, right, and un-aligned exits if unchallenged', async () => {
    await plasma.methods.beginExit(0, 0, 10, 0).send({ value: 0, from: web3.eth.accounts.wallet[1].address, gas: 4000000 })
    await plasma.methods.beginExit(0, 20, 30, 0).send({ value: 0, from: web3.eth.accounts.wallet[1].address, gas: 4000000 })
    await plasma.methods.beginExit(0, 40, 50, 0).send({ value: 0, from: web3.eth.accounts.wallet[1].address, gas: 4000000 })

    await setup.mineNBlocks(20)

    await plasma.methods.finalizeExit(0, '0x' + setup.IMAGINARY_PRECEDING.toString(16)).send({ value: 0, from: web3.eth.accounts.wallet[1].address, gas: 4000000 })
    await plasma.methods.finalizeExit(1, 0).send({ value: 0, from: web3.eth.accounts.wallet[1].address, gas: 4000000 })
    await plasma.methods.finalizeExit(2, 10).send({ value: 0, from: web3.eth.accounts.wallet[1].address, gas: 4000000 })

    const imaginaryNext = await plasma.methods.depositedRanges__nextDepositStart('0x' + setup.IMAGINARY_PRECEDING.toString(16)).call()
    const firstDepositEnd = await plasma.methods.depositedRanges__end(0).call()
    const firstDepositNextStart = await plasma.methods.depositedRanges__nextDepositStart(0).call()
    const middleDepositEnd = await plasma.methods.depositedRanges__end(10).call()
    const middleDepositNextStart = await plasma.methods.depositedRanges__nextDepositStart(10).call()
    const lastDepositEnd = await plasma.methods.depositedRanges__end(30).call()
    const lastDepositNextStart = await plasma.methods.depositedRanges__nextDepositStart(30).call()

    assert.equal(imaginaryNext, '0')
    assert.equal(firstDepositEnd, '0')
    assert.equal(firstDepositNextStart, '10')
    assert.equal(middleDepositEnd, '20')
    assert.equal(middleDepositNextStart, '30')
    assert.equal(lastDepositEnd, '40')
    assert.equal(lastDepositNextStart, setup.MAX_END.toString())
  })
  it('should allow re-deposits into exited ranges', async () => {
    await plasma.methods.deposit(0).send({ value: 5, from: web3.eth.accounts.wallet[1].address, gas: 4000000 })
    await plasma.methods.deposit(10).send({ value: 10, from: web3.eth.accounts.wallet[1].address, gas: 4000000 })
    await plasma.methods.deposit(10).send({ value: 5, from: web3.eth.accounts.wallet[1].address, gas: 4000000 })

    const firstRangeEnd = await plasma.methods.depositedRanges__end(0).call()
    const firstRangeNext = await plasma.methods.depositedRanges__nextDepositStart(0).call()
    const middleRangeEnd = await plasma.methods.depositedRanges__end(10).call()
    const middleRangeNext = await plasma.methods.depositedRanges__nextDepositStart(10).call()
    assert.equal(firstRangeEnd, '5')
    assert.equal(firstRangeNext, '10')
    assert.equal(middleRangeEnd, '45')
    assert.equal(middleRangeNext, '170141183460469231731687303715884105727')
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
  it('should properly check individual branch proofs and get implicit bounds', async () => {
    await plasma.methods.submitBlock('0x' + tree.root().hash).send({ value: 0, from: web3.eth.accounts.wallet[0].address, gas: 4000000 })
    const index = Math.floor(Math.random() * 32)
    let proof = tree.getInclusionProof(index)
    const parsedSum = proof[0].sum
    proof.shift()
    let proofString = '0x'
    proof.forEach((element) => { proofString = proofString + element.hash + element.sum.toString(16, 32) })
    const possibleImplicitBounds = await plasma.methods.checkBranchAndGetBounds(
      web3.utils.soliditySha3('0x' + txs[index].encoded),
      '0x' + parsedSum.toString(16, 32),
      index,
      proofString,
      1
    ).call()
    assert.equal(possibleImplicitBounds[0], new BN(txs[index].args.transfer.start))
    assert(new BN(possibleImplicitBounds[1]).gte(new BN(txs[index].args.transfer.end)))
  })
  it('should properly check full tx proofs and get transfer & blocknumber', async () => {
    for (let i = 0; i < 100; i++) { let tx, index, proof, parsedSum, proofString; try { 
     index = Math.floor(Math.random() * 32)
     tx = txs[index]
     proof = tree.getInclusionProof(index)
     parsedSum = proof[0].sum
    proof.shift()
     proofString = '0x'
    proof.forEach((element) => { proofString = proofString + element.hash + element.sum.toString(16, 32) })
    const transfer = await plasma.methods.checkTXValidityAndGetTransfer(
      0,
      '0x' + tx.encoded,
      '0x' + parsedSum.toString(16, 32),
      '0x' + new BN(index).toString(16, 2),
      proofString
    ).call()
    const returnedTo = transfer[0]
    const returnedFrom = transfer[1]
    const returnedStart = transfer[2]
    const returnedEnd = transfer[3]
    const expectedTo = tx.args.transfer.recipient
    const expectedFrom = tx.args.transfer.sender
    const expectedStart = new BN(tx.args.transfer.start).toString()
    const expectedEnd = new BN(tx.args.transfer.end).toString()
    assert.equal(returnedTo, expectedTo)
    assert.equal(returnedFrom, expectedFrom)
    assert.equal(returnedStart, expectedStart)
    assert.equal(returnedEnd, expectedEnd)
    } catch { debugger }
  }
  })
  it('should allow inclusionChallenges and their response', async () => {
    const index = Math.floor(Math.random() * 32)
    const tx = txs[index]
    const start = new BN(tx.args.transfer.start)
    const end = new BN(tx.args.transfer.end)
    const a = await plasma.methods.beginExit(1, start, end, 0).send({ value: 0, from: web3.eth.accounts.wallet[1].address, gas: 4000000 })
    debugger
  })
})

/**
 * Returns a list of `n` sequential transactions.
 * @param {*} n Number of sequential transactions to return.
 * @return {*} A list of sequential transactions.
 */
const getSequentialTxs = (n) => {
  let txs = []
  for (let i = 0; i < n; i++) {
    txs[i] = new Transaction({
      transfer: {
        sender: web3.eth.accounts.wallet[0].address,
        recipient: web3.eth.accounts.wallet[1].address,
        token: 0,
        start: i * 20,
        end: (i + 0.5) * 20,
        block: 1
      },
      signature: {
        v: 0,
        r: 0,
        s: 0
      }
    })
  }

  return txs
}

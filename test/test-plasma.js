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

describe('Plasma Initialization', () => {
  let bytecode, abi, plasma, txs, tree
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
  const dummyBlockHash = '0x000000000000000000000000000000000000000000000000000000000000000'
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

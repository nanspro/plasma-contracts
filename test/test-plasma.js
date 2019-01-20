/* eslint-env mocha */
/* eslint-disable no-unused-expressions */

/* NOTE: filename has a 0 appended so that mocha loads this first,
so that contract deployment is only done once.  If you create a new
test, do it with a before() as in other files, not this one */

const chai = require('chai')
const expect = chai.expect
const assert = chai.assert

const Web3 = require('web3')
const BN = Web3.utils.BN

const plasmaUtils = require('plasma-utils')
const PlasmaMerkleSumTree = plasmaUtils.PlasmaMerkleSumTree
const models = plasmaUtils.serialization.models
const Transaction = models.Transaction
const TransferProof = models.TransferProof
const TransactionProof = models.TransactionProof
const genSequentialTXs = plasmaUtils.utils.getSequentialTxs
const genRandomTX = plasmaUtils.utils.genRandomTX
const setup = require('./setup-plasma')
const web3 = setup.web3
genSequentialTXs
const CHALLENGE_PERIOD = 20

describe('Plasma Smart Contract', () => {
  let bytecode, abi, plasma, operatorSetup, freshContractSnapshot
  // BEGIN SETUP
  before(async () => {
    // setup ganache, deploy, etc.
    [
      bytecode, abi, plasma, operatorSetup, freshContractSnapshot
    ] = await setup.setupPlasma()
  })
  describe('Deployment', () => {
    it('Should have compiled the vyper contract without errors', async () => {
      expect(abi).to.exist
      expect(bytecode).to.exist
      expect(plasma).to.exist
      expect(web3).to.exist
    })
    it('Should have setup() the contract for without errors', async () => {
      expect(operatorSetup).to.exist
    })
  })

  // BEGIN OPERATOR SECTION
  describe('Operator Usage', () => {
    it('should allow a block to be published by the operator', async () => {
      const dummyBlockHash = '0x000000000000000000000000000000000000000000000000000000000000000'
      await setup.mineNBlocks(10) // blocktime is 10
      await plasma.methods.submitBlock(dummyBlockHash).send({ value: 0, from: web3.eth.accounts.wallet[0].address, gas: 4000000 }).catch((error) => { console.log('send callback failed: ', error) })
    })
  })

  // BEGIN DECODING SECTION
  describe('Serialization Decoding', () => {
    let randomTXEncoding, randomTX, randomTransferIndex, randomTransferEncoding
    let encodedSignature, decodedSignature, encodedTransferProof, decodedTransferProof, testTransferProof, encodedTransactionProof, decodedTransactionProof, transactionProof
    before(async () => {
      const numTransfers = 4
      const blockNum = 1
      randomTXEncoding = genRandomTX(blockNum, web3.eth.accounts.wallet[3].address, web3.eth.accounts.wallet[3].address, numTransfers)
      randomTX = new Transaction(randomTXEncoding)
      randomTXEncoding = '0x' + randomTXEncoding
      randomTransferIndex = Math.floor(Math.random() * 4)
      randomTransferEncoding = '0x' + randomTX.transfers[randomTransferIndex].encoded.toLowerCase()
      encodedSignature = '1bd693b532a80fed6392b428604171fb32fdbf953728a3a7ecc7d4062b1652c04224e9c602ac800b983b035700a14b23f78a253ab762deab5dc27e3555a750b354'
      decodedSignature = {
        v: '1b',
        r: 'd693b532a80fed6392b428604171fb32fdbf953728a3a7ecc7d4062b1652c042',
        s: '24e9c602ac800b983b035700a14b23f78a253ab762deab5dc27e3555a750b354'
      }
      encodedTransferProof = '00000000000000000000000000000003' + '00000000000000000000000000000004' + encodedSignature + '01' + '563f225cdc192264a90e7e4b402815479c71a16f1593afa4fc6323e18583472affffffffffffffffffffffffffffffff'
      decodedTransferProof = {
        parsedSum: new BN('3', 'hex'),
        leafIndex: new BN('4', 'hex'),
        inclusionProof: [
          '563f225cdc192264a90e7e4b402815479c71a16f1593afa4fc6323e18583472affffffffffffffffffffffffffffffff'
        ],
        signature: decodedSignature
      }
      testTransferProof = new TransferProof(decodedTransferProof)
      encodedTransactionProof = '01' + encodedTransferProof
      decodedTransactionProof = {
        transferProofs: [
          decodedTransferProof
        ]
      }
      transactionProof = new TransactionProof(decodedTransactionProof)
    })
    describe('Transfer Decoding', () => {
      it('should decode a transfer sender', async () => {
        const decoded = await plasma.methods.decodeSender(randomTransferEncoding).call()
        const expected = randomTX.args.transfers[randomTransferIndex].sender.toLowerCase()
        assert.equal(decoded.toLowerCase(), expected)
      })
      it('should decode a transfer recipient', async () => {
        const decoded = await plasma.methods.decodeRecipient(randomTransferEncoding).call()
        const expected = randomTX.args.transfers[randomTransferIndex].recipient.toLowerCase()
        assert.equal(decoded.toLowerCase(), expected)
      })
      it('should decode a token type bytes', async () => {
        const decoded = await plasma.methods.decodeTokenTypeBytes(randomTransferEncoding).call()
        const expected = '0x' + randomTX.args.transfers[randomTransferIndex].token.toString(16, 8)
        assert.equal(decoded, expected)
      })
      it('should decode a token type as uint', async () => {
        const decoded = await plasma.methods.decodeTokenType(randomTransferEncoding).call()
        const expected = randomTX.args.transfers[randomTransferIndex].token.toString()
        assert.equal(decoded, expected)
      })
      it('should decode a transfer range', async () => {
        const decoded = await plasma.methods.decodeTransferRange(randomTransferEncoding).call()
        const expectedType = randomTX.args.transfers[randomTransferIndex].token.toString(16, 8)
        const expectedStart = randomTX.args.transfers[randomTransferIndex].start.toString(16, 12)
        const expectedEnd = randomTX.args.transfers[randomTransferIndex].end.toString(16, 12)
        const expected = [
          new BN(expectedType + expectedStart, 16).toString(),
          new BN(expectedType + expectedEnd, 16).toString()
        ]
        assert.equal(decoded[0], expected[0])
        assert.equal(decoded[1], expected[1])
      })
    })
    describe('Transaction Decoding', () => {
      it('should getLeafHash of an encoded transaction', async () => {
        const possibleHash = await plasma.methods.getLeafHash(randomTXEncoding).call()
        assert.equal(possibleHash, randomTX.hash)
      })
      it('should decodeBlockNumber from a tx', async () => {
        const decoded = await plasma.methods.decodeBlockNumber(randomTXEncoding).call()
        const expected = new BN(randomTX.args.block).toString()
        assert.equal(decoded, expected)
      })
      it('should decodeNumTransfers from a tx', async () => {
        const decoded = await plasma.methods.decodeNumTransfers(randomTXEncoding).call()
        const expected = new BN(randomTX.args.transfers.length).toString()
        assert.equal(decoded, expected)
      })
      it('should decode the ith transfer', async () => {
        const index = 0
        const decoded = await plasma.methods.decodeIthTransfer(index, randomTXEncoding).call()
        const transfer = randomTX.transfers[index]
        const expected = '0x' + transfer.encoded.toLowerCase()
        assert.equal(decoded, expected)
      })
    })
    describe('Transfer Proof Decoding', () => {
      it('should decodeParsedSumBytes', async () => {
        const decoded = await plasma.methods.decodeParsedSumBytes('0x' + encodedTransferProof).call()
        const expected = '0x' + testTransferProof.args.parsedSum.toString(16, 32)
        assert.equal(decoded, expected)
      })
      it('should decodeLeafIndex', async () => {
        const decoded = await plasma.methods.decodeLeafIndex('0x' + encodedTransferProof).call()
  
        const expected = testTransferProof.args.leafIndex.toString()
        assert.equal(decoded, expected)
      })
      it('should decodeSignature', async () => {
        const decoded = await plasma.methods.decodeSignature('0x' + encodedTransferProof).call()
        const expected = [
          '0x' + new BN(testTransferProof.args.signature.v).toString(16, 2),
          '0x' + new BN(testTransferProof.args.signature.r).toString(16, 64),
          '0x' + new BN(testTransferProof.args.signature.s).toString(16, 64)
        ]
        assert.equal(decoded[0], expected[0])
        assert.equal(decoded[1], expected[1])
        assert.equal(decoded[2], expected[2])
      })
      it('should decodeNumInclusionProofNodesFromTRProof', async () => {
        const decoded = await plasma.methods.decodeNumInclusionProofNodesFromTRProof('0x' + encodedTransferProof).call()
        const expected = testTransferProof.args.inclusionProof.length
        assert.equal(decoded, expected)
      })
      it('should decodeIthInclusionProofNode', async () => {
        const decoded = await plasma.methods.decodeIthInclusionProofNode(0, '0x' + encodedTransferProof).call()
        const expected = '0x' + new BN(testTransferProof.args.inclusionProof[0]).toString(16)
        assert.equal(decoded, expected)
      })
    })
    describe('Transaction Proof Decoding', () => {
      it('should decodeNumTransactionProofs', async () => {
        const decoded = await plasma.methods.decodeNumTransactionProofs('0x' + encodedTransactionProof).call()
        const expected = new BN(transactionProof.args.transferProofs.length).toString()
        assert.equal(decoded, expected)
      })
  
      it('should decodeNumInclusionProofNodesFromTXProof', async () => {
        const decoded = await plasma.methods.decodeNumInclusionProofNodesFromTXProof('0x' + encodedTransactionProof).call()
        const expected = testTransferProof.args.inclusionProof.length
        assert.equal(decoded, expected)
      })
      it('should decodeIthTransferProofWithNumNodes', async () => {
        const decoded = await plasma.methods.decodeIthTransferProofWithNumNodes(0, 1, '0x' + encodedTransactionProof).call()
        const expected = '0x' + encodedTransferProof
        assert.equal(decoded, expected)
      })
    })
  })

  // BEGIN PROOF CHECKING SECTION
  describe('Proof Checking', () => {
    let TXIndex, txs, tx, tree
    before(async () => {
      // tree for testing branch checking
      TXIndex = 0
      txs = genSequentialTXs(2)
      tx = txs[TXIndex]
      tree = new PlasmaMerkleSumTree(txs)
    })
    it('should checkTransferProofAndGetBounds', async () => {
      await setup.revertToChainSnapshot(freshContractSnapshot)
      await plasma.methods.submitBlock('0x' + tree.root().hash).send({ value: 0, from: web3.eth.accounts.wallet[0].address, gas: 4000000 })
      const possibleImplicitBounds = await plasma.methods.checkTransferProofAndGetBounds(
        web3.utils.soliditySha3('0x' + tx.encoded),
        0,
        '0x' + tree.getTransferProof(0).encoded
      ).call()
      assert.equal(possibleImplicitBounds[0], new BN(0))
      assert(new BN(possibleImplicitBounds[1]).gte(new BN(txs[0].args.transfers[0].end)))
    })
    it('should checkTXValidityAndGetTransfer', async () => {
      const requestedTransfer = await plasma.methods.checkTXValidityAndGetTransfer(
        '0x' + tx.encoded,
        '0x' + tree.getTransactionProof(tx).encoded,
        0
      ).call()
      const expectedSender = tx.transfers[0].args.sender
      const expectedRecipient = tx.transfers[0].args.recipient
      const expectedStart = tx.transfers[0].args.start.toString()
      const expectedEnd = tx.transfers[0].args.end.toString()
      const expectedBlockNum = tx.args.block.toString()
      assert.equal(requestedTransfer[0].toLowerCase(), expectedSender)
      assert.equal(requestedTransfer[1].toLowerCase(), expectedRecipient)
      assert.equal(requestedTransfer[2], expectedStart)
      assert.equal(requestedTransfer[3], expectedEnd)
      assert.equal(requestedTransfer[4], expectedBlockNum)
    })
  })
  // BEGIN DEPOSITS AND EXITS SECTION
  describe('Deposits and Exits', () => {
    it('should allow a first deposit and add it to the deposits correctly', async () => {
      const depositSize = 50
      await plasma.methods.submitDeposit().send({ value: depositSize, from: web3.eth.accounts.wallet[1].address, gas: 4000000 })
      const exitableStart = await plasma.methods.exitable(depositSize).call()
      const depositStart = await plasma.methods.deposits__start(depositSize).call()
      const depositer = await plasma.methods.deposits__depositer(depositSize).call()
      assert.equal(exitableStart, '0')
      assert.equal(depositStart, '0')
      assert.equal(depositer, web3.eth.accounts.wallet[1].address)
    })
    it('should allow a second deposit and add it to the deposits correctly', async () => {
      const depositSize = 500
      await plasma.methods.submitDeposit().send({ value: depositSize, from: web3.eth.accounts.wallet[2].address, gas: 4000000 })
      const depositEnd = 550 // 550 hardcoded from above deposit of 50
      const exitableStart = await plasma.methods.exitable(depositEnd).call()
      const depositStart = await plasma.methods.deposits__start(depositEnd).call()
      const depositer = await plasma.methods.deposits__depositer(depositEnd).call()
      assert.equal(exitableStart, '0')
      assert.equal(depositStart, '50')
      assert.equal(depositer, web3.eth.accounts.wallet[2].address)
    })
    it('should allow that users `beginExit`s', async () => {
      const plasmaBlock = '0'
      const exitStart = '0'
      const exitEnd = '10'
      await plasma.methods.beginExit(plasmaBlock, exitStart, exitEnd).send({ value: 0, from: web3.eth.accounts.wallet[1].address, gas: 4000000 })
      const exitID = 0 // hardcode since this is all a deterministic test
      const exiter = await plasma.methods.exits__exiter(exitID).call()
      assert.equal(exiter, web3.eth.accounts.wallet[1].address)
    })
    it('should properly finalize leftmost, rightmost, and middle exits', async () => {
      // this test finalizes exits in order of left, right, middle.
      // LEFT EXIT: (0, 10) -- beginExit() already happened in the last test
      await setup.mineNBlocks(CHALLENGE_PERIOD) // finalizing exits in order of left, right, middle for testing variety
      await plasma.methods.finalizeExit(0, 550).send({ value: 0, from: web3.eth.accounts.wallet[1].address, gas: 4000000 })
  web3.eth.accounts.wallet.add(privateKey)
}
// For all provider options, see: https://github.com/trufflesuite/ganache-cli#library
web3.setProvider(ganache.provider({
  accounts: ganacheAccounts,
  locked: false,
  logger: console
}))

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

/*
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
*/

/*
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
*/

describe('Plasma', () => {
  let bytecode, abi, plasmaCt, plasma // , freshContractSnapshot

  before(async () => {
    [bytecode, abi] = await compileVyper('./contracts/plasmaprime.vy')
    const addr = web3.eth.accounts.wallet[0].address

    plasmaCt = new web3.eth.Contract(JSON.parse(abi), addr, { from: addr, gas: 2500000, gasPrice: '300000' })
    // const balance = await web3.eth.getBalance(accounts[0].address)
    const bn = await web3.eth.getBlockNumber()
    await mineBlock()
    const bn2 = await web3.eth.getBlockNumber()
    log(bn)
    log(bn2)
    // Now try to deploy
    plasma = await plasmaCt.deploy({ data: bytecode }).send()

    const block = await web3.eth.getBlock('latest')
    await web3.eth.getTransaction(block.transactions[0])
    // freshContractSnapshot = await getCurrentChainSnapshot()
  })

  it('Should compile the vyper contract without errors', async () => {
    log('Bytecode: ', bytecode.slice(0, 300), '...\n ABI: ', abi.slice(0, 300), '...')
    expect(abi).to.exist
    expect(bytecode).to.exist
    expect(plasma).to.exist
    expect(web3).to.exist
    expect(ganache).to.exist
  })

  const dummyBlockHash = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
  it('should allow a block to be published by the operator', async () => {
    await mineNBlocks(10) // blocktime is 10
    await plasma.methods.submitBlock(dummyBlockHash).send({ value: 0, from: web3.eth.accounts.wallet[0].address, gas: 4000000 }, async function (error, result) { // get callback from function which is your transaction key
      if (!error) {
        // const receipt = await web3.eth.getTransactionReceipt(result)
      } else {
        assert.equal(true, false) // theres a better way but need to fail tests when things throw
        console.log(error)
      }
    }).catch((error) => {
      console.log('send callback failed: ', error)
    })
  })

  // let bigDepositSnapshot
  it('should allow a first deposit and add it to the deposits correctly', async () => {
    let depositEnd, depositNextStart
    const depositSize = 50
    await plasma.methods.deposit(0).send({ value: depositSize, from: web3.eth.accounts.wallet[1].address, gas: 4000000 }, async function (error, result) { // get callback from function which is your transaction key
      if (error) {
        assert.equal(true, false) // theres a better way but need to fail tests when things throw
        console.log(error)
      }
    }).catch((error) => {
      console.log('send callback failed: ', error)
    })
    depositEnd = await plasma.methods.depositedRanges__end(0).call()
    depositNextStart = await plasma.methods.depositedRanges__nextDepositStart(0).call()
    assert.deepEqual(new BN(depositEnd), new BN(depositSize))
    assert.deepEqual(new BN(depositNextStart), MAX_END)
    // bigDepositSnapshot = getCurrentChainSnapshot()
  })

  it('should allow left, right, and un-aligned exits if unchallenged', async () => {
    await plasma.methods.beginExit(1, 0, 10, 0).send({ value: 0, from: web3.eth.accounts.wallet[1].address, gas: 4000000 })
    await plasma.methods.beginExit(1, 20, 30, 0).send({ value: 0, from: web3.eth.accounts.wallet[1].address, gas: 4000000 })
    await plasma.methods.beginExit(1, 40, 50, 0).send({ value: 0, from: web3.eth.accounts.wallet[1].address, gas: 4000000 })

    await mineNBlocks(20)

    await plasma.methods.finalizeExit(0, '0x' + IMAGINARY_PRECEDING.toString(16)).send({ value: 0, from: web3.eth.accounts.wallet[1].address, gas: 4000000 })
    await plasma.methods.finalizeExit(1, 0).send({ value: 0, from: web3.eth.accounts.wallet[1].address, gas: 4000000 })
    await plasma.methods.finalizeExit(2, 10).send({ value: 0, from: web3.eth.accounts.wallet[1].address, gas: 4000000 })

      // now do the end: exiting 300, 550 -> exitID 1
      const plasmaBlock = '0'
      await plasma.methods.beginExit(plasmaBlock, 300, 550).send({ value: 0, from: web3.eth.accounts.wallet[1].address, gas: 4000000 })
      await setup.mineNBlocks(CHALLENGE_PERIOD)
      await plasma.methods.finalizeExit(1, 550).send({ value: 0, from: web3.eth.accounts.wallet[1].address, gas: 4000000 })

      // now do the middle: 100,200 -> exitID 2
      await plasma.methods.beginExit(plasmaBlock, 100, 200).send({ value: 0, from: web3.eth.accounts.wallet[1].address, gas: 4000000 })
      await setup.mineNBlocks(CHALLENGE_PERIOD)
      await plasma.methods.finalizeExit(2, 300).send({ value: 0, from: web3.eth.accounts.wallet[1].address, gas: 4000000 })

      const firstExitableStart = await plasma.methods.exitable(100).call()
      const secondExitableStart = await plasma.methods.exitable(300).call()
      assert.equal(firstExitableStart, '10')
      assert.equal(secondExitableStart, '200')
    })
    it('should properly process a new deposit after the rightmost coin was exited', async () => {
      const depositSize = 420
      await plasma.methods.submitDeposit().send({ value: depositSize, from: web3.eth.accounts.wallet[2].address, gas: 4000000 })
      const depositEnd = 970 // total deposits were now 50 + 500 + 420
      const exitableStart = await plasma.methods.exitable(depositEnd).call()
      assert.equal(exitableStart, '550')
    })
    assert.equal(imaginaryNext, '0')
    assert.equal(firstDepositEnd, '0')
    assert.equal(firstDepositNextStart, '10')
    assert.equal(middleDepositEnd, '20')
    assert.equal(middleDepositNextStart, '30')
    assert.equal(lastDepositEnd, '40')
    assert.equal(lastDepositNextStart, MAX_END.toString())
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
  // it('should allow inclusionChallenges and their response', async () => {
  //   const index = Math.floor(Math.random() * txs.length)
  //   const tx = txs[index]
  //   const start = new BN(tx.args.transfer.start)
  //   const end = new BN(tx.args.transfer.end)
  //   const a = await plasma.methods.beginExit(1, start, end, 0).send({ value: 0, from: web3.eth.accounts.wallet[1].address, gas: 4000000 })
  //   debugger
  // })
})
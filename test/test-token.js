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
const Transfer = models.Transfer
const UnsignedTransaction = models.UnsignedTransaction
const SignedTransaction = models.SignedTransaction
const TransferProof = models.TransferProof
const TransactionProof = models.TransactionProof
const genSequentialTXs = plasmaUtils.utils.getSequentialTxs
const genRandomTX = plasmaUtils.utils.genRandomTX
const setup = require('./setup-plasma')
const getCurrentChainSnapshot = setup.getCurrentChainSnapshot
const web3 = setup.web3
const CHALLENGE_PERIOD = 20

describe.only('ERC20 Token Support', () => {
  let bytecode, abi, plasma, operatorSetup, freshContractSnapshot
  let tokenBytecode, tokenAbi, token, tokenSetup

  // BEGIN SETUP
  before(async () => {
    // setup ganache, deploy, etc.
    [
      bytecode, abi, plasma, operatorSetup, freshContractSnapshot
    ] = await setup.setupPlasma()
    ;
    [
      tokenBytecode, tokenAbi, token
    ] = await setup.setupToken()
    debugger
    token
  })

  describe('Deployment', () => {
    it('Should have compiled the plasma contract without errors', async () => {
      expect(abi).to.exist
      expect(bytecode).to.exist
      expect(plasma).to.exist
      expect(web3).to.exist
    })
    it('Should have setup() the contract for without errors', async () => {
      expect(operatorSetup).to.exist
    })
    it('Should have compiled the plasma contract without errors', async () => {
      expect(tokenAbi).to.exist
      expect(tokenBytecode).to.exist
      expect(token).to.exist
    })
  })
})

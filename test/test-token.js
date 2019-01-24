/* eslint-env mocha */
/* eslint-disable no-unused-expressions */

/* NOTE: filename has a 0 appended so that mocha loads this first,
so that contract deployment is only done once.  If you create a new
test, do it with a before() as in other files, not this one */

const chai = require('chai')
const expect = chai.expect

const setup = require('./setup-plasma')
const web3 = setup.web3
const CHALLENGE_PERIOD = 20

describe('ERC20 Token Support', () => {
  const [operator, alice, bob, carol, dave] = [ // eslint-disable-line no-unused-vars
    web3.eth.accounts.wallet[0].address,
    web3.eth.accounts.wallet[1].address,
    web3.eth.accounts.wallet[2].address,
    web3.eth.accounts.wallet[3].address,
    web3.eth.accounts.wallet[4].address
  ]

  const benTokenType = 1
  const benCoinDenomination = '3' // --> ERC20 bal = plasma balance * 10^3
  let listingNonce = 1
  let exitNonce = 0

  let bytecode, abi, plasma, operatorSetup, freshContractSnapshot // eslint-disable-line no-unused-vars
  let tokenBytecode, tokenAbi, token
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
  })

  describe('Listings, Deposits, Exits', () => {
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
    it('should allow the operator to list a new token', async () => {
      await plasma.methods.listToken(token._address, benCoinDenomination).send()

      const listingAddress = await plasma.methods.listings__contractAddress(listingNonce).call()
      const listingDenomination = await plasma.methods.listings__decimalOffset(listingNonce).call()

      expect(listingAddress).to.equal(token._address)
      expect(listingDenomination).to.equal(benCoinDenomination)
    })
    const aliceDepositSize = '100'
    const aliceNumPlasmaCoins = aliceDepositSize * Math.pow(10, benCoinDenomination)
    it('should allow allice to approve and deposit', async () => {
      await token.methods.approve(plasma._address, aliceDepositSize).send({ from: alice })

      await plasma.methods.submitERC20Deposit(token._address, aliceDepositSize).send({ from: alice })

      const newContractBalance = await token.methods.balanceOf(plasma._address).call()
      expect(newContractBalance).to.equal(aliceDepositSize)

      const newDepositStart = await plasma.methods.deposits__start(1, aliceNumPlasmaCoins).call()
      expect(newDepositStart).to.equal('0') // first deposit tokentype 1 ^ should equal 0 since it was the first

      const newDepositer = await plasma.methods.deposits__depositer(1, aliceNumPlasmaCoins).call()
      expect(newDepositer).to.equal(alice)
    })
    it('should allow bob to exit the ERC20s if uncontested', async () => {
      await plasma.methods.beginExit(benTokenType, 0, 0, aliceNumPlasmaCoins).send({ from: bob })
      const exitID = exitNonce
      exitNonce++

      await setup.mineNBlocks(CHALLENGE_PERIOD)

      await plasma.methods.finalizeExit(exitID, aliceNumPlasmaCoins).send()

      const newPlasmaBalance = await token.methods.balanceOf(plasma._address).call()
      const newBobBalance = await token.methods.balanceOf(bob).call()

      expect(newBobBalance).to.equal(aliceDepositSize)
      expect(newPlasmaBalance).to.equal('0')
    })
  })
})

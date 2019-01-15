/* eslint-env mocha */
/* eslint-disable no-unused-expressions */
const chai = require('chai')
const expect = chai.expect // eslint-disable-line no-unused-vars
const assert = chai.assert

const Web3 = require('web3')
const BN = Web3.utils.BN

const setup = require('./setup-plasma')
const web3 = setup.web3

let bytecode, abi, plasma, freshContractSnapshot // eslint-disable-line no-unused-vars
describe('Deposits and Exits', () => {
  setup
  before(async () => {
    [bytecode, abi, plasma, freshContractSnapshot] = setup.get()
  })
  it('should allow a first deposit and add it to the deposits correctly', async () => {
    let depositEnd, depositNextStart
    const depositSize = 50
    await plasma.methods.deposit(0).send({ value: depositSize, from: web3.eth.accounts.wallet[1].address, gas: 4000000 }, async function (error, result) { // get callback from function which is your transaction key
      if (error) {
        assert.equal(true, false) // there's a better way but need to fail tests when things throw
        console.log(error)
      }
    }).catch((error) => { console.log('send callback failed: ', error) })
    depositEnd = await plasma.methods.depositedRanges__end(0).call()
    depositNextStart = await plasma.methods.depositedRanges__nextDepositStart(0).call()
    assert.deepEqual(new BN(depositEnd), new BN(depositSize))
    assert.deepEqual(new BN(depositNextStart), setup.MAX_END)
  })
  it('should allow left, right, and un-aligned exits if unchallenged', async () => {
    debugger
    await plasma.methods.beginExit(0, 0, 10, 0).send({ value: 0, from: web3.eth.accounts.wallet[1].address, gas: 4000000 })
    await plasma.methods.beginExit(0, 20, 30, 0).send({ value: 0, from: web3.eth.accounts.wallet[1].address, gas: 4000000 })
    await plasma.methods.beginExit(0, 40, 50, 0).send({ value: 0, from: web3.eth.accounts.wallet[1].address, gas: 4000000 })
    debugger
    await setup.mineNBlocks(20)
    debugger
    await plasma.methods.finalizeExit(0, '0x' + setup.IMAGINARY_PRECEDING.toString(16)).send({ value: 0, from: web3.eth.accounts.wallet[1].address, gas: 4000000 })
    await plasma.methods.finalizeExit(1, 0).send({ value: 0, from: web3.eth.accounts.wallet[1].address, gas: 4000000 })
    await plasma.methods.finalizeExit(2, 10).send({ value: 0, from: web3.eth.accounts.wallet[1].address, gas: 4000000 })
    debugger
    const imaginaryNext = await plasma.methods.depositedRanges__nextDepositStart('0x' + setup.IMAGINARY_PRECEDING.toString(16)).call()
    const firstDepositEnd = await plasma.methods.depositedRanges__end(0).call()
    const firstDepositNextStart = await plasma.methods.depositedRanges__nextDepositStart(0).call()
    const middleDepositEnd = await plasma.methods.depositedRanges__end(10).call()
    const middleDepositNextStart = await plasma.methods.depositedRanges__nextDepositStart(10).call()
    const lastDepositEnd = await plasma.methods.depositedRanges__end(30).call()
    const lastDepositNextStart = await plasma.methods.depositedRanges__nextDepositStart(30).call()
    debugger
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
})

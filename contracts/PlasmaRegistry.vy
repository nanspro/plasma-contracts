contract PlasmaChain():
    def setup(operator: address, operatorIpAddress: bytes32): modifying

NewPlasmaChain: event({PlasmaChainAddress: indexed(address), OperatorAddress: indexed(address), OperatorIpAddress: indexed(bytes32)})

plasmaChainTemplate: public(address)

@public
def initializeRegistry(template: address):
    assert self.plasmaChainTemplate == ZERO_ADDRESS
    assert template != ZERO_ADDRESS
    self.plasmaChainTemplate = template

@public
def createPlasmaChain(operator: address, operatorIpAddress: bytes32) -> address:
    assert self.plasmaChainTemplate != ZERO_ADDRESS
    plasmaChain: address = create_with_code_of(self.plasmaChainTemplate)
    PlasmaChain(plasmaChain).setup(operator, operatorIpAddress)
    log.NewPlasmaChain(plasmaChain, operator, operatorIpAddress)
    return plasmaChain

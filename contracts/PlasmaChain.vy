#TODO: always check uints greater than 0?

struct deposit:
    start: uint256
    depositer: address
    precedingPlasmaBlockNumber: uint256

struct exitableRange:
    start: uint256
    isSet: bool

struct Exit:
    exiter: address
    plasmaBlockNumber: uint256
    ethBlockNumber: uint256
    start: uint256
    end: uint256
    challengeCount: uint256

struct inclusionChallenge:
    exitID: uint256
    ongoing: bool

struct invalidHistoryChallenge:
    exitID: uint256
    coinID: uint256
    blockNumber: uint256
    recipient: address
    ongoing: bool

operator: public(address)
nextPlasmaBlockNumber: public(uint256)
lastPublish: public(uint256) # ethereum block number of most recent plasma block
blockHashes: public(map(uint256, bytes32))

exits: public(map(uint256, Exit))
exitNonce: public(uint256)
challengeNonce: public(uint256)

exitable: public(map(uint256, exitableRange)) # end -> start because it makes for cleaner code
deposits: public(map(uint256, deposit)) # also end -> start for consistency
totalDeposited: public(uint256)

inclusionChallenges: public(map(uint256, inclusionChallenge))
invalidHistoryChallenges: public(map(uint256, invalidHistoryChallenge))

# period (of ethereum blocks) during which an exit can be challenged
CHALLENGE_PERIOD: constant(uint256) = 20
# period (of ethereum blocks) during which an invalid history history challenge can be responded
SPENTCOIN_CHALLENGE_PERIOD: constant(uint256) = CHALLENGE_PERIOD / 2
# minimum number of ethereum blocks between new plasma blocks
PLASMA_BLOCK_INTERVAL: constant(uint256) = 0

MAX_TREE_DEPTH: constant(int128) = 8
MAX_TRANSFERS: constant(uint256) = 4

# @public
# def ecrecover_util(message_hash: bytes32, signature: bytes[65]) -> address:
#     v: uint256 = extract32(slice(signature, start=0, len=32), 0, type=uint256)
#     r: uint256 = extract32(slice(signature, start=32, len=64), 0, type=uint256)
#     s: bytes[1] = slice(signature, start=64, len=1)
#     s_pad: uint256 = extract32(s, 0, type=uint256)
#
#     addr: address = ecrecover(message_hash, v, r, s_pad)
#     return addr

### BEGIN TRANSACTION DECODING SECION ###

# Note: TX Encoding Lengths
#
# The MAX_TRANSFERS should be a tunable constant, but vyper doesn't 
# support 'bytes[constant var]' so it has to be hardcoded.  The formula
# for calculating the encoding size is:
#     TX_BLOCK_DECODE_LEN + 
#     TX_NUM_TRANSFERS_LEN +
#     MAX_TRANSFERS * TRANSFER_LEN 
# Currently we take MAX_TRANSFERS = 4, so the max TX encoding bytes is:
# 4 + 1 + 4 * 68 = 277

@public
def getLeafHash(transactionEncoding: bytes[277]) -> bytes32:
    return sha3(transactionEncoding)

TX_BLOCKNUM_START: constant(int128) = 0
TX_BLOCKNUM_LEN: constant(int128) = 4
@public
def decodeBlockNumber(transactionEncoding: bytes[277]) -> uint256:
    bn: bytes[32] = slice(transactionEncoding,
            start = TX_BLOCKNUM_START,
            len = TX_BLOCKNUM_LEN)
    return convert(bn, uint256)

TX_NUM_TRANSFERS_START: constant(int128) = 4
TX_NUM_TRANSFERS_LEN: constant(int128) = 1
@public
def decodeNumTransfers(transactionEncoding: bytes[277]) -> uint256:
    num: bytes[2] = slice(transactionEncoding,
            start = TX_NUM_TRANSFERS_START,
            len = TX_NUM_TRANSFERS_LEN)
    return convert(num, uint256)

FIRST_TR_START: constant(int128) = 5
TR_LEN: constant(int128) = 68
@public
def decodeIthTransfer(
    index: int128,
    transactionEncoding: bytes[277]
) -> bytes[68]:
    transfer: bytes[68] = slice(transactionEncoding,
        start = TR_LEN * index + FIRST_TR_START,
        len = TR_LEN
    )
    return transfer

### BEGIN TRANSFER DECODING SECTION ###

@private
def bytes20ToAddress(addr: bytes[20]) -> address:
    padded: bytes[52] = concat(EMPTY_BYTES32, addr)
    return convert(convert(slice(padded, start=20, len=32), bytes32), address)

SENDER_START: constant(int128) = 0
SENDER_LEN: constant(int128) = 20
@public
def decodeSender(
    transferEncoding: bytes[68]
) -> address:
    addr: bytes[20] = slice(transferEncoding,
        start = SENDER_START,
        len = SENDER_LEN)
    return self.bytes20ToAddress(addr)

RECIPIENT_START: constant(int128) = 20
RECIPIENT_LEN: constant(int128) = 20
@public
def decodeRecipient(
    transferEncoding: bytes[68]
) -> address:
    addr: bytes[20] = slice(transferEncoding,
        start = RECIPIENT_START,
        len = RECIPIENT_LEN)
    return self.bytes20ToAddress(addr)

TR_TOKEN_START: constant(int128) = 40
TR_TOKEN_LEN: constant(int128) = 4
@public
def decodeTokenTypeBytes(
    transferEncoding: bytes[68]
) -> bytes[4]:
    tokenType: bytes[4] = slice(transferEncoding, 
        start = TR_TOKEN_START,
        len = TR_TOKEN_LEN)
    return tokenType

@public
def decodeTokenType(
    transferEncoding: bytes[68]
) -> uint256:
    return convert(
        self.decodeTokenTypeBytes(transferEncoding), 
        uint256
    )

TR_START_START: constant(int128) = 44
TR_START_LEN: constant(int128) = 12
TR_END_START: constant(int128) = 56
TR_END_LEN: constant(int128) = 12
@public
def decodeTransferRange(
    transferEncoding: bytes[68]
) -> (uint256, uint256): # start, end
    tokenType: bytes[4] = self.decodeTokenTypeBytes(transferEncoding)
    untypedStart: bytes[12] = slice(transferEncoding,
        start = TR_START_START,
        len = TR_START_LEN)
    untypedEnd: bytes[12] = slice(transferEncoding,
        start = TR_END_START,
        len = TR_END_LEN)
    return (
        convert(concat(tokenType, untypedStart), uint256),
        convert(concat(tokenType, untypedEnd), uint256)
    )

### BEGIN TRANSFERPROOF DECODING SECTION ###

# Note on TransferProofEncoding size:
# It will always really be at most 
# PARSED_SUM_LEN + LEAF_INDEX_LEN + ADDRESS_LEN + PROOF_COUNT_LEN + MAX_TREE_DEPTH * TREENODE_LEN
# = 16 + 16 + 20 + 1 + 8 * 48 = 437
# but because of dumb type casting in vyper, it thinks it *might* 
# be larger because we slice the TX encoding to get it.  So it has to be
# TRANSFERPROOF_COUNT_LEN + 437 * MAX_TRANSFERS = 1 + 1744 * 4 = 1749

TREENODE_LEN: constant(int128) = 48

PARSEDSUM_START: constant(int128) = 0
PARSEDSUM_LEN: constant(int128) = 16
@public
def decodeParsedSumBytes(
    transferProofEncoding: bytes[1749] 
) -> bytes[16]:
    parsedSum: bytes[16] = slice(transferProofEncoding,
        start = PARSEDSUM_START,
        len = PARSEDSUM_LEN)
    return parsedSum

LEAFINDEX_START: constant(int128) = 16
LEAFINDEX_LEN: constant(int128) = 16
@public
def decodeLeafIndex(
    transferProofEncoding: bytes[1749]
) -> int128:
    leafIndex: bytes[16] = slice(transferProofEncoding,
        start = LEAFINDEX_START,
        len = PARSEDSUM_LEN)
    return convert(leafIndex, int128)

SIG_START:constant(int128) = 32
SIGV_OFFSET: constant(int128) = 0
SIGV_LEN: constant(int128) = 1
SIGR_OFFSET: constant(int128) = 1
SIGR_LEN: constant(int128) = 32
SIGS_OFFSET: constant(int128) = 33
SIGS_LEN: constant(int128) = 32
@public
def decodeSignature(
    transferProofEncoding: bytes[1749]
) -> (
    bytes[1], # v
    bytes32, # r
    bytes32 # s
):
    sig: bytes[65] = slice(transferProofEncoding,
        start = SIG_START,
        len = SIGV_LEN + SIGR_LEN + SIGS_LEN
    )
    sigV: bytes[1] = slice(sig,
        start = SIGV_OFFSET,
        len = SIGV_LEN)
    sigR: bytes[32] = slice(sig,
        start = SIGR_OFFSET,
        len = SIGR_LEN)
    sigS: bytes[32] = slice(sig,
        start = SIGS_OFFSET,
        len = SIGS_LEN)
    return (
        sigV,
        convert(sigR, bytes32),
        convert(sigS, bytes32)
    )

NUMPROOFNODES_START: constant(int128) = 97
NUMPROOFNODES_LEN: constant(int128) = 1
@public
def decodeNumInclusionProofNodesFromTRProof(transferProof: bytes[1749]) -> int128:
    numNodes: bytes[1] = slice(
        transferProof,
        start = NUMPROOFNODES_START,
        len = NUMPROOFNODES_LEN
    )
    return convert(numNodes, int128)

INCLUSIONPROOF_START: constant(int128) = 98
@public
def decodeIthInclusionProofNode(
    index: int128,
    transferProofEncoding: bytes[1749]
) -> bytes[48]: # = MAX_TREE_DEPTH * TREENODE_LEN = 384 is what it should be but because of variable in slice vyper won't let us say that :(
    proofNode: bytes[48] = slice(transferProofEncoding, 
        start = index * TREENODE_LEN + INCLUSIONPROOF_START,
        len =  TREENODE_LEN)
    return proofNode

### BEGIN TRANSACTION PROOF DECODING SECTION ###

# The smart contract assumes the number of nodes in every TRProof are equal.
FIRST_TRANSFERPROOF_START: constant(int128) = 1
@public
def decodeNumInclusionProofNodesFromTXProof(transactionProof: bytes[1749]) -> int128:
    firstTransferProof: bytes[1749] = slice(
        transactionProof,
        start = FIRST_TRANSFERPROOF_START,
        len = NUMPROOFNODES_START + 1 # + 1 so we include the numNodes
    )
    return self.decodeNumInclusionProofNodesFromTRProof(firstTransferProof)


NUMTRPROOFS_START: constant(int128) = 0
NUMTRPROOFS_LEN: constant(int128) = 1
@public
def decodeNumTransactionProofs(
    transactionProofEncoding: bytes[1749]
) -> int128:
    numInclusionProofs: bytes[1] = slice(
        transactionProofEncoding,
        start = NUMTRPROOFS_START,
        len = NUMTRPROOFS_LEN
    )
    return convert(numInclusionProofs, int128)

@public
def decodeIthTransferProofWithNumNodes(
    index: int128,
    numInclusionProofNodes: int128,
    transactionProofEncoding: bytes[1749]
) -> bytes[1749]:
    transactionProofLen: int128 = (
        PARSEDSUM_LEN +
        LEAFINDEX_LEN +
        SIGS_LEN + SIGV_LEN + SIGR_LEN +
        NUMPROOFNODES_LEN + 
        TREENODE_LEN * numInclusionProofNodes
    )
    transferProof: bytes[1749] = slice(
        transactionProofEncoding,
        start = index * transactionProofLen + FIRST_TRANSFERPROOF_START,
        len = transactionProofLen
    )
    return transferProof

@public
def checkTransferProofAndGetBounds(
    leafHash: bytes32,
    blockNum: uint256,
    transferProof: bytes[1749]
) -> (uint256, uint256): # implicitstart, implicitEnd
    parsedSum: bytes[16] = self.decodeParsedSumBytes(transferProof)
    numProofNodes: int128 = self.decodeNumInclusionProofNodesFromTRProof(transferProof)
    leafIndex: int128 = self.decodeLeafIndex(transferProof)

    computedNode: bytes[48] = concat(leafHash, parsedSum)
    totalSum: uint256 = convert(parsedSum, uint256)
    leftSum: uint256 = 0
    rightSum: uint256 = 0
    pathIndex: int128 = leafIndex
    
    for nodeIndex in range(MAX_TREE_DEPTH):
        if nodeIndex == numProofNodes:
            break
        proofNode: bytes[48] = self.decodeIthInclusionProofNode(nodeIndex, transferProof)
        siblingSum: uint256 = convert(slice(proofNode, start=32, len=16), uint256)
        totalSum += siblingSum
        hashed: bytes32
        if pathIndex % 2 == 0:
            hashed = sha3(concat(computedNode, proofNode))
            rightSum += siblingSum
        else:
            hashed = sha3(concat(proofNode, computedNode))
            leftSum += siblingSum
        totalSumAsBytes: bytes[16] = slice( #This is all a silly trick since vyper won't directly convert numbers to bytes[]...classic :P
            concat(EMPTY_BYTES32, convert(totalSum, bytes32)),
            start=48,
            len=16
        )
        computedNode = concat(hashed, totalSumAsBytes)
        pathIndex /= 2
    rootHash: bytes[32] = slice(computedNode, start=0, len=32)
    rootSum: uint256 = convert(slice(computedNode, start=32, len=16), uint256)
    assert convert(rootHash, bytes32) == self.blockHashes[blockNum]
    return (leftSum, rootSum - rightSum)

COINID_BYTES: constant(int128) = 16
PROOF_MAX_LENGTH: constant(uint256) = 384 # 384 = TREENODE_LEN (48) * MAX_TREE_DEPTH (8) 
ENCODING_LENGTH_PER_TRANSFER: constant(int128) = 165

@public
def checkTransactionProofAndGetTransfer(
        transactionEncoding: bytes[277],
        transactionProofEncoding: bytes[1749],
        transferIndex: int128
    ) -> (
        address, # transfer.to
        address, # transfer.from
        uint256, # transfer.start
        uint256, # transfer.end
        uint256 # transaction plasmaBlockNumber
    ):
    leafHash: bytes32 = self.getLeafHash(transactionEncoding)
    plasmaBlockNumber: uint256 = self.decodeBlockNumber(transactionEncoding)


    numTransfers: int128 = convert(self.decodeNumTransfers(transactionEncoding), int128)
    numInclusionProofNodes: int128 = self.decodeNumInclusionProofNodesFromTXProof(transactionProofEncoding)

    requestedTransferStart: uint256 # these will be the ones at the trIndex we are being asked about by the exit game
    requestedTransferEnd: uint256
    requestedTransferTo: address
    requestedTransferFrom: address
    for i in range(MAX_TRANSFERS):
        if i == numTransfers: #loop for max possible transfers, but break so we don't go past
            break
        transferEncoding: bytes[68] = self.decodeIthTransfer(i, transactionEncoding)
        
        transferProof: bytes[1749] = self.decodeIthTransferProofWithNumNodes(
            i,
            numInclusionProofNodes,
            transactionProofEncoding
        )

        implicitStart: uint256
        implicitEnd: uint256


        (implicitStart, implicitEnd) = self.checkTransferProofAndGetBounds(
            leafHash,
            plasmaBlockNumber,
            transferProof
        )

        transferStart: uint256
        transferEnd: uint256

        (transferStart, transferEnd) = self.decodeTransferRange(transferEncoding)

        assert implicitStart <= transferStart
        assert transferStart < transferEnd
        assert transferEnd <= implicitEnd

        v: bytes[1] # v
        r: bytes32 # r
        s: bytes32 # s
        (v, r, s) = self.decodeSignature(transferProof)
        sender: address = self.decodeSender(transferEncoding)
        # TODO: add signature check here!

        if i == transferIndex:
            requestedTransferTo = self.decodeRecipient(transferEncoding)
            requestedTransferFrom = sender
            requestedTransferStart = transferStart
            requestedTransferEnd = transferEnd


    return (
        requestedTransferTo,
        requestedTransferFrom,
        requestedTransferStart,
        requestedTransferEnd,
        plasmaBlockNumber
    )

### BEGIN CONTRACT LOGIC ###

@public
def setup(_operator: address):
    self.operator = _operator
    self.nextPlasmaBlockNumber = 1 # starts at 1 so deposits before the first block have a precedingPlasmaBlock of 0 since it can't be negative (it's a uint)
    self.exitNonce = 0
    self.lastPublish = 0
    self.challengeNonce = 0
    self.totalDeposited = 0
    self.exitable[0].start = 0
    self.exitable[0].isSet = True
    
@public
def submitBlock(newBlockHash: bytes32):
    assert msg.sender == self.operator
    assert block.number >= self.lastPublish + PLASMA_BLOCK_INTERVAL

    self.blockHashes[self.nextPlasmaBlockNumber] = newBlockHash
    self.nextPlasmaBlockNumber += 1
    self.lastPublish = block.number

### BEGIN DEPOSITS AND EXITS SECTION ###

@public
@payable
def submitDeposit():
    depositAmount: uint256 = as_unitless_number(msg.value)
    assert depositAmount > 0

    oldEnd: uint256 = self.totalDeposited
    oldRange: exitableRange = self.exitable[oldEnd] # remember, map is end -> start!

    self.totalDeposited += depositAmount # add deposit
    # removed, replace with per ERC -->    assert self.totalDeposited < MAX_END # make sure we're not at capacity
    clear(self.exitable[oldEnd]) # delete old exitable range
    self.exitable[self.totalDeposited] = oldRange #make exitable

    self.deposits[self.totalDeposited].start = oldEnd # the range (oldEnd, newTotalDeposited) was deposited by the depositer
    self.deposits[self.totalDeposited].depositer = msg.sender
    self.deposits[self.totalDeposited].precedingPlasmaBlockNumber = self.nextPlasmaBlockNumber - 1

@public
def beginExit(blockNumber: uint256, start: uint256, end: uint256) -> uint256:
    assert blockNumber < self.nextPlasmaBlockNumber

    exitID: uint256 = self.exitNonce
    self.exits[exitID].exiter = msg.sender
    self.exits[exitID].plasmaBlockNumber = blockNumber
    self.exits[exitID].ethBlockNumber = block.number
    self.exits[exitID].start = start
    self.exits[exitID].end = end
    self.exits[exitID].challengeCount = 0

    self.exitNonce += 1
    return exitID

@public
def checkRangeExitable(start: uint256, end: uint256, claimedExitableEnd: uint256):
    assert end <= claimedExitableEnd
    assert start >= self.exitable[claimedExitableEnd].start
    assert self.exitable[claimedExitableEnd].isSet

# this function updates the exitable ranges to reflect a newly finalized exit.
@public # make private once tested!!!!
def removeFromExitable(start: uint256, end: uint256, exitableEnd: uint256):
    oldStart: uint256 = self.exitable[exitableEnd].start
    #todo fix/check  the case with totally filled exit finalization
    if start != oldStart: # then we have a new exitable region to the left
        self.exitable[start].start = oldStart # new exitable range from oldstart to the start of the exit (which has just become the end of the new exitable range)
        self.exitable[start].isSet = True
    if end != exitableEnd: # then we have leftovers to the right which are exitable
        self.exitable[exitableEnd].start = end # and it starts at the end of the finalized exit!
        self.exitable[exitableEnd].isSet = True
    else: # otherwise, no leftovers on the right, so we can delete the map entry...
        if end != self.totalDeposited: # ...UNLESS it's the rightmost deposited value, which we need to keep (even though it will be "empty", i.e. have start == end,because submitDeposit() uses it to make the new deposit exitable)
            clear(self.exitable[end])
        else: # and if it is the rightmost, 
            self.exitable[end].start = end # start = end so won't ever be exitable, but allows for new deposit logic to work

@public
def finalizeExit(exitID: uint256, exitableEnd: uint256) -> uint256:
    exiter: address = self.exits[exitID].exiter
    exitethBlockNumber: uint256 = self.exits[exitID].ethBlockNumber
    exitStart: uint256  = self.exits[exitID].start
    exitEnd: uint256 = self.exits[exitID].end
    challengeCount: uint256 = self.exits[exitID].challengeCount

    self.checkRangeExitable(exitStart, exitEnd, exitableEnd)
    self.removeFromExitable(exitStart, exitEnd, exitableEnd)

    assert challengeCount == 0
    assert block.number > exitethBlockNumber + CHALLENGE_PERIOD

    exitValue: wei_value = as_wei_value(exitEnd - exitStart, "wei")
    send(exiter, exitValue)
    return exitEnd

@public
def challengeBeforeDeposit(
    exitID: uint256,
    coinID: uint256,
    depositEnd: uint256
):
    # note: this can always be challenged because no response and all info on-chain, no invalidity period needed
    depositPrecedingPlasmaBlock: uint256 = self.deposits[depositEnd].precedingPlasmaBlockNumber
    assert self.deposits[depositEnd].depositer != ZERO_ADDRESS # requires the deposit to be a valid deposit and not something unset
    
    depositStart: uint256 = self.deposits[depositEnd].start

    assert coinID >= depositStart
    assert coinID < depositEnd

    assert depositPrecedingPlasmaBlock > self.exits[exitID].plasmaBlockNumber

    clear(self.exits[exitID])

@public
def challengeInclusion(exitID: uint256):
    # check the exit being challenged exists
    assert exitID < self.exitNonce

    # check we can still challenge
    exitethBlockNumber: uint256 = self.exits[exitID].ethBlockNumber
    assert block.number < exitethBlockNumber + CHALLENGE_PERIOD

    # store challenge
    challengeID: uint256 = self.challengeNonce
    self.inclusionChallenges[challengeID].exitID = exitID

    self.inclusionChallenges[challengeID].ongoing = True
    self.exits[exitID].challengeCount += 1

    self.challengeNonce += 1

@public
def respondTransactionInclusion(
        challengeID: uint256,
        transferIndex: int128,
        transactionEncoding: bytes[277],
        transactionProofEncoding: bytes[1749],
):
    assert self.inclusionChallenges[challengeID].ongoing

    transferStart: uint256 # these will be the ones at the trIndex we are being asked about by the exit game
    transferEnd: uint256
    transferRecipient: address
    transferSender: address
    responseBlockNumber: uint256

    (
        transferRecipient,
        transferSender,
        transferStart, 
        transferEnd, 
        responseBlockNumber
    ) = self.checkTransactionProofAndGetTransfer(
        transactionEncoding,
        transactionProofEncoding,
        transferIndex
    )

    exitID: uint256 = self.inclusionChallenges[challengeID].exitID
    exiter: address = self.exits[exitID].exiter
    exitPlasmaBlockNumber: uint256 = self.exits[exitID].plasmaBlockNumber

    # check exit exiter is indeed recipient
    assert transferRecipient == exiter

    #check the inclusion was indeed at this block
    assert exitPlasmaBlockNumber == responseBlockNumber

    # response was successful
    clear(self.inclusionChallenges[challengeID])
    self.exits[exitID].challengeCount -= 1

@public
def respondDepositInclusion(
    challengeID: uint256,
    depositEnd: uint256
):
    assert self.inclusionChallenges[challengeID].ongoing
    
    exitID: uint256 = self.inclusionChallenges[challengeID].exitID
    exiter: address = self.exits[exitID].exiter
    exitPlasmaBlockNumber: uint256 = self.exits[exitID].plasmaBlockNumber

    # check exit exiter is indeed recipient
    depositer: address = self.deposits[depositEnd].depositer
    assert depositer == exiter

    #check the inclusion was indeed at this block
    depositBlockNumber: uint256 = self.deposits[depositEnd].precedingPlasmaBlockNumber
    assert exitPlasmaBlockNumber == depositBlockNumber

    # response was successful
    clear(self.inclusionChallenges[challengeID])
    self.exits[exitID].challengeCount -= 1

@public
def challengeSpentCoin(
    exitID: uint256,
    coinID: uint256,
    transferIndex: int128,
    transactionEncoding: bytes[277],
    transactionProofEncoding: bytes[1749],
):
    # check we can still challenge
    exitethBlockNumberNumber: uint256 = self.exits[exitID].ethBlockNumber
    assert block.number < exitethBlockNumberNumber + SPENTCOIN_CHALLENGE_PERIOD

    transferStart: uint256 # these will be the ones at the trIndex we are being asked about by the exit game
    transferEnd: uint256
    transferRecipient: address
    transferSender: address
    bn: uint256

    (
        transferRecipient,
        transferSender,
        transferStart, 
        transferEnd, 
        bn
    ) = self.checkTransactionProofAndGetTransfer(
        transactionEncoding,
        transactionProofEncoding,
        transferIndex
    )

    exiter: address = self.exits[exitID].exiter
    exitPlasmaBlockNumber: uint256 = self.exits[exitID].plasmaBlockNumber
    exitStart: uint256 = self.exits[exitID].start
    exitEnd: uint256 = self.exits[exitID].end

    # check the coinspend came after the exit block
    assert bn > exitPlasmaBlockNumber

    # check the coinspend intersects both the exit and proven transfer
    assert coinID >= exitStart
    assert coinID < exitEnd
    assert coinID >= transferStart
    assert coinID < transferEnd

    # check the sender was the exiter
    #assert transferSender == exiter

    # if all these passed, the coin was indeed spent.  CANCEL!
    clear(self.exits[exitID])

@private
def challengeInvalidHistory(
    exitID: uint256,
    coinID: uint256,
    claimant: address,
    start: uint256,
    end: uint256,
    blockNumber: uint256
):
    # check we can still challenge
    exitethBlockNumberNumber: uint256 = self.exits[exitID].ethBlockNumber
    assert block.number < exitethBlockNumberNumber + CHALLENGE_PERIOD

    # check the coinspend came before the exit block
    assert blockNumber < self.exits[exitID].plasmaBlockNumber

    # check the coinspend intersects the exit
    assert coinID >= self.exits[exitID].start
    assert coinID < self.exits[exitID].end
    # check the coinspend intersects the proven transfer
    assert coinID >= start
    assert coinID < end

    # check the exit being challenged exists
    assert exitID < self.exitNonce

    # get and increment challengeID
    challengeID: uint256 = self.challengeNonce
    self.exits[exitID].challengeCount += 1
    
    self.challengeNonce += 1

    # store challenge
    self.invalidHistoryChallenges[challengeID].ongoing = True
    self.invalidHistoryChallenges[challengeID].exitID = exitID
    self.invalidHistoryChallenges[challengeID].coinID = coinID
    self.invalidHistoryChallenges[challengeID].recipient = claimant
    self.invalidHistoryChallenges[challengeID].blockNumber = blockNumber

@public
def challengeInvalidHistoryWithTransaction(
    exitID: uint256,
    coinID: uint256,
    transferIndex: int128,
    transactionEncoding: bytes[277],
    transactionProofEncoding: bytes[1749]
):
    transferStart: uint256 # these will be the ones at the trIndex we are being asked about by the exit game
    transferEnd: uint256
    transferRecipient: address
    transferSender: address
    bn: uint256

    (
        transferRecipient,
        transferSender,
        transferStart, 
        transferEnd, 
        bn
    ) = self.checkTransactionProofAndGetTransfer(
        transactionEncoding,
        transactionProofEncoding,
        transferIndex
    )

    self.challengeInvalidHistory(
        exitID,
        coinID,
        transferRecipient,
        transferStart,
        transferEnd,
        bn
    )

@public
def challengeInvalidHistoryWithDeposit(
    exitID: uint256,
    coinID: uint256,
    depositEnd: uint256
):
    depositer: address = self.deposits[depositEnd].depositer
    assert depositer != ZERO_ADDRESS # make sure the deposit was really set/valid

    depositStart: uint256 = self.deposits[depositEnd].start
    depositBlockNumber: uint256 = self.deposits[depositEnd].precedingPlasmaBlockNumber

    self.challengeInvalidHistory(
        exitID,
        coinID,
        depositer,
        depositStart,
        depositEnd,
        depositBlockNumber
    )

@public
def respondInvalidHistoryTransaction(
        challengeID: uint256,
        transferIndex: int128,
        transactionEncoding: bytes[277],
        transactionProofEncoding: bytes[1749],
):

    assert self.invalidHistoryChallenges[challengeID].ongoing

    transferStart: uint256 # these will be the ones at the trIndex we are being asked about by the exit game
    transferEnd: uint256
    transferRecipient: address
    transferSender: address
    bn: uint256

    (
        transferRecipient,
        transferSender,
        transferStart, 
        transferEnd, 
        bn
    ) = self.checkTransactionProofAndGetTransfer(
        transactionEncoding,
        transactionProofEncoding,
        transferIndex
    )

    chalRecipient: address = self.invalidHistoryChallenges[challengeID].recipient
    chalBlockNumber: uint256 = self.invalidHistoryChallenges[challengeID].blockNumber

    exitID: uint256 = self.invalidHistoryChallenges[challengeID].exitID
    exitPlasmaBlockNumber: uint256 = self.exits[exitID].plasmaBlockNumber

    # check exit the response's sender is indeed the challenge's recipient
    assert chalRecipient == transferSender

    # check the response was between exit and challenge
    assert bn > chalBlockNumber
    assert bn <= exitPlasmaBlockNumber

    # response was successful
    clear(self.invalidHistoryChallenges[challengeID])
    self.exits[exitID].challengeCount -= 1

@public
def respondInvalidHistoryDeposit(
    challengeID: uint256,
    depositEnd: uint256
):
    assert self.invalidHistoryChallenges[challengeID].ongoing

    chalRecipient: address = self.invalidHistoryChallenges[challengeID].recipient
    chalBlockNumber: uint256 = self.invalidHistoryChallenges[challengeID].blockNumber

    exitID: uint256 = self.invalidHistoryChallenges[challengeID].exitID
    exitPlasmaBlockNumber: uint256 = self.exits[exitID].plasmaBlockNumber

    depositBlockNumber: uint256 = self.deposits[depositEnd].precedingPlasmaBlockNumber
    # check the response was between exit and challenge
    assert depositBlockNumber > chalBlockNumber
    assert depositBlockNumber <= exitPlasmaBlockNumber

    # response was successful
    clear(self.invalidHistoryChallenges[challengeID])
    self.exits[exitID].challengeCount -= 1
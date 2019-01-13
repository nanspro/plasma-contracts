#TODO: always check uints greater than 0

struct Exit:
    exiter: address
    plasmaBlock: uint256
    ethBlock: uint256
    start: uint256
    end: uint256
    challengeCount: uint256

struct inclusionChallenge:
    exitID: uint256
    ongoing: bool

struct depositedRange:
    end: uint256
    nextDepositStart: uint256

operator: public(address)
deposits: public(map(address, wei_value))
nextPlasmaBlockNum: public(uint256)
last_publish: public(uint256) # ethereum block number of most recent plasma block
blockHashes: public(map(uint256, bytes32))

depositedRanges: public(map(uint256, depositedRange))

exits: public(map(uint256, Exit))
inclusionChallenges: public(map(uint256, inclusionChallenge))
exitNonce: public(uint256)
challengeNonce: public(uint256)

# period (of ethereum blocks) during which an exit can be challenged
CHALLENGE_PERIOD: constant(uint256) = 20
# minimum number of ethereum blocks between new plasma blocks
PLASMA_BLOCK_INTERVAL: constant(uint256) = 10
#
MAX_TREE_DEPTH: constant(int128) = 8
MAX_TRANSFERS: constant(uint256) = 4
MAX_END: constant(uint256) = 170141183460469231731687303715884105727
TREE_NODE_BYTES: constant(int128) = 48


# @public
# def ecrecover_util(message_hash: bytes32, signature: bytes[65]) -> address:
#     v: uint256 = extract32(slice(signature, start=0, len=32), 0, type=uint256)
#     r: uint256 = extract32(slice(signature, start=32, len=64), 0, type=uint256)
#     s: bytes[1] = slice(signature, start=64, len=1)
#     s_pad: uint256 = extract32(s, 0, type=uint256)
#
#     addr: address = ecrecover(message_hash, v, r, s_pad)
#     return addr

@public
def __init__():
    self.operator = msg.sender
    self.nextPlasmaBlockNum = 0
    self.exitNonce = 0
    self.last_publish = 0
    self.challengeNonce = 0
    self.depositedRanges[0] = depositedRange({end: 0, nextDepositStart: MAX_END})
    self.depositedRanges[MAX_END] = depositedRange({end:MAX_END, nextDepositStart: MAX_END})
    self.depositedRanges[MAX_END+1] = depositedRange({end: MAX_END+1, nextDepositStart: 0}) # this is not really a deposited range (it's beyond then MAX_END bounday) but we need it so we can pass a precedingDeposit to the finalizeExit function.  There, we check if this END+1 was the thing passed and if so we leave it alone

@public
def submitBlock(newBlockHash: bytes32):
    assert msg.sender == self.operator
    assert block.number >= self.last_publish + PLASMA_BLOCK_INTERVAL

    self.blockHashes[self.nextPlasmaBlockNum] = newBlockHash
    self.nextPlasmaBlockNum += 1
    self.last_publish = block.number

@public
@payable
def deposit(leftDepositStart: uint256):
    #todo: type checking for tokentypes
    assert msg.value > 0
    leftDeposit: depositedRange = self.depositedRanges[leftDepositStart]
    rightDepositStart: uint256 = leftDeposit.nextDepositStart
    rightDeposit: depositedRange = self.depositedRanges[rightDepositStart]
    
    assert rightDepositStart > leftDeposit.end # if they did trickery with the last deposit, not sure if the next line auto detects this
    emptySpaceBetweenDeposits: uint256 = rightDepositStart - leftDeposit.end

    depositAmount: uint256 = as_unitless_number(msg.value)
    assert depositAmount <=  emptySpaceBetweenDeposits 
    if emptySpaceBetweenDeposits == depositAmount: # then it filled the whole thing so we gotta make the left deposited a big one and (? see TBD two lines below) eliminate exitabilty from the right one altogether
        self.depositedRanges[leftDepositStart].end = rightDeposit.end
        self.depositedRanges[leftDepositStart].nextDepositStart = rightDeposit.nextDepositStart
        #TBD: is this line actually needed or is it fine to not touch rightDepositStart? I think not
        #TODO fix syntax on this line and uncomment
        #self.depositedRanges[rightDepositStart] = depositedRange(rightDepositStart, rightDepositStart) # first val is the way to prevent exits on the key. we could never use it to exit because it ends where it starts. second val prevents accidentally depositing into an already deposited range
    else:
        self.depositedRanges[leftDepositStart].end = leftDeposit.end + depositAmount

@private
@constant
def checkRangeIsExitable(start: uint256, end: uint256, depositStart: uint256):
    #todo check start/end do not exceed bounds and are well-ordered
    assert depositStart <= start
    assert self.depositedRanges[depositStart].end >= end

@public
def beginExit(bn: uint256, start: uint256, end: uint256, depositStart: uint256) -> uint256:
    #todo check doesn't span multiple tokentypes because that would make finalizing exits a hastle (but prob not break any logic...)
    assert bn < self.nextPlasmaBlockNum

    self.checkRangeIsExitable(start, end, depositStart)

    en: uint256 = self.exitNonce
    self.exits[en].exiter = msg.sender
    self.exits[en].plasmaBlock = bn
    self.exits[en].ethBlock = block.number
    self.exits[en].start = start
    self.exits[en].end = end
    self.exits[en].challengeCount = 0
    self.exitNonce += 1
    return en

@public
def finalizeExit(exitID: uint256, precedingDepositStart: uint256): #slightly counterintuitive but we get the deposit slot BEFORE the affected deposit start -- in case we need to update its nextStart reference
    assert block.number >= self.exits[exitID].ethBlock + CHALLENGE_PERIOD
    assert self.exits[exitID].challengeCount == 0

    exitStart: uint256 = self.exits[exitID].start
    exitEnd: uint256 = self.exits[exitID].end

    #oldRange is the deposit range we are exiting from, pre-finalization
    oldRangeStart: uint256 = self.depositedRanges[precedingDepositStart].nextDepositStart
    oldRange: depositedRange = self.depositedRanges[oldRangeStart]

    self.checkRangeIsExitable(exitStart, exitEnd, oldRangeStart) # check again in case an earlier exit was finalized

    # to the right of our exit is a new depositrange, starting at the exit's end, pointing to the original nextDeposit, and ending at the original depositRange end (this might make its start == end if the exit is right-aligned, but that's fine -- it would never pass a checkRangeIsExitable())
    self.depositedRanges[exitEnd].end = oldRange.end
    self.depositedRanges[exitEnd].nextDepositStart = oldRange.nextDepositStart

    # to the left of our exit is the old depositrange, but now we give it this a new end positiion of the exit's start.
    self.depositedRanges[oldRangeStart].end = exitStart

    if oldRange.end == exitEnd: #if the exit *was* right-aligned (and therefore the depositRange from the prev line is "empty"--see above)...
        self.depositedRanges[oldRangeStart].nextDepositStart = oldRange.nextDepositStart # (cont) ...then we need to point to the original nextStart, *not* the empty one, so that an exit can be done on the full range at once
    else: 
        self.depositedRanges[oldRangeStart].nextDepositStart =  exitEnd # otherwise it was not and we point to the end of our exit
    # the AND below is if we're using the "out of range" preceding deposit to point to the oldRange, because in that case we don't wanna merge the ranges.  we could also add a bool input to finalize exit but this is cleaner code-wise
    if oldRangeStart == exitStart and precedingDepositStart != MAX_END + 1: #similarly, if the exit was left-aligned (note: might have been both!) ...
        self.depositedRanges[precedingDepositStart].nextDepositStart = self.depositedRanges[oldRangeStart].nextDepositStart # then the preceding range must point to whatever the we decided the affectedDeposit points to in the above if statement.

    send(self.exits[exitID].exiter, as_wei_value(exitEnd - exitStart, 'wei'))


@public
def challengeInclusion(exitID: uint256) -> uint256:
    # check the exit being challenged exists
    assert exitID < self.exitNonce

    # store challenge
    challengeID: uint256 = self.challengeNonce
    self.inclusionChallenges[challengeID].exitID = exitID
    self.inclusionChallenges[challengeID].ongoing = True
    self.exits[exitID].challengeCount += 1

    self.challengeNonce += 1
    return challengeID

@public
def getLeafHash(transactionEncoding: bytes[165]) -> bytes32:
    return sha3(transactionEncoding)

TRANSFER_BLOCK_DECODE_POS: constant(int128) = 68
TRANSFER_BLOCK_DECODE_LEN: constant(int128) = 32
@public
def decodeBlockNumber(transactionEncoding: bytes[165]) -> uint256:
    #this should technically be checking every TR, buuuut we're gonna pull it out of transfers anyway.
    bn: bytes[32] = slice(transactionEncoding,
            start = TRANSFER_BLOCK_DECODE_POS,
            len = TRANSFER_BLOCK_DECODE_LEN)
    return convert(bn, uint256)

TOTAL_TRANSFER_SIZE: constant(int128) = 100
TRANSFER_TOKEN_DECODE_POS: constant(int128) = 40
TRANSFER_TOKEN_DECODE_LEN: constant(int128) = 4
TRANSFER_START_DECODE_POS: constant(int128) = 44
TRANSFER_START_DECODE_LEN: constant(int128) = 12
TRANSFER_END_DECODE_POS: constant(int128) = 56
TRANSFER_END_DECODE_LEN: constant(int128) = 12
@public
def decodeIthTransferBounds(
    index: int128,
    transactionEncoding: bytes[165]
) -> (
    uint256, # start
    uint256 # end
):
    token: bytes[4] = slice(transactionEncoding, 
        start = index * TOTAL_TRANSFER_SIZE + TRANSFER_TOKEN_DECODE_POS,
        len = TRANSFER_TOKEN_DECODE_LEN)
    start: bytes[12] = slice(transactionEncoding,
        start = index * TOTAL_TRANSFER_SIZE + TRANSFER_START_DECODE_POS,
        len = TRANSFER_START_DECODE_LEN)
    end: bytes[12] = slice(transactionEncoding,
        start = index * TOTAL_TRANSFER_SIZE + TRANSFER_END_DECODE_POS,
        len = TRANSFER_END_DECODE_LEN)
    return (
        convert(concat(token, start), uint256),
        convert(concat(token, end), uint256)
    )

TRANSFER_FROM_DECODE_POS: constant(int128) = 0
TRANSFER_FROM_DECODE_LEN: constant(int128) = 20
@public
def decodeIthTransferFrom(
    index: int128,
    transactionEncoding: bytes[165]
) -> address:
    addr: bytes[20] = slice(transactionEncoding,
    start = index * TOTAL_TRANSFER_SIZE + TRANSFER_FROM_DECODE_POS,
    len = TRANSFER_FROM_DECODE_LEN)
    addrAsB32: bytes32 = convert(addr, bytes32)
    return convert(addrAsB32, address)

TRANSFER_TO_DECODE_POS: constant(int128) = 20
TRANSFER_TO_DECODE_LEN: constant(int128) = 20
@public
def decodeIthTransferTo(
    index: int128,
    transactionEncoding: bytes[165]
) -> address:
    addr: bytes[20] = slice(transactionEncoding,
        start = index * TOTAL_TRANSFER_SIZE + TRANSFER_TO_DECODE_POS,
        len = TRANSFER_TO_DECODE_LEN)
    addrAsB32: bytes32 = convert(addr, bytes32)
    return convert(addrAsB32, address)

MERKLE_NODE_BYTES: constant(int128) = 48
@public
def checkBranchAndGetBounds(
    leafHash: bytes32, 
    parsedSum: bytes[16], 
    leafIndex: int128, # which leaf in the merkle sum tree this branch is
    proof: bytes[1536], # will always really be at most 384 = MAX_TREE_DEPTH (8) * MERKLE_NODE_BYTES (48).  but because of dumb type casting in vyper, it thinks it *might* be larger because we have a variable slice.
    bn: uint256 # plasma block number
) -> (uint256, uint256):
    computedNode: bytes[48] = concat(leafHash, parsedSum)
    totalSum: uint256 = convert(parsedSum, uint256)
    leftSum: uint256 = 0
    rightSum: uint256 = 0
    pathIndex: int128 = leafIndex
    for nodeIndex in range(MAX_TREE_DEPTH):
        if nodeIndex * MERKLE_NODE_BYTES == len(proof):
            break
        proofNode: bytes[48] = slice(
            proof, 
            start = nodeIndex * TREE_NODE_BYTES, 
            len = TREE_NODE_BYTES
        )
        siblingSum: uint256 = convert(slice(proofNode, start=32, len=16), uint256)
        totalSum += siblingSum
        hashed: bytes32
        if pathIndex % 2 == 0:
            hashed = sha3(concat(computedNode, proofNode))
            rightSum += siblingSum
        else:
            hashed = sha3(concat(proofNode, computedNode))
            leftSum += siblingSum
        totalSumAsBytes: bytes[16] = slice( #This is all a silly trick since vyper won't direct convert numbers to bytes[]
            concat(EMPTY_BYTES32, convert(totalSum, bytes32)),
            start=48,
            len=16
        )
        computedNode = concat(hashed, totalSumAsBytes)
        pathIndex /= 2
    rootHash: bytes[32] = slice(computedNode, start=0, len=32)
    rootSum: uint256 = convert(slice(computedNode, start=32, len=16), uint256)
    assert convert(rootHash, bytes32) == self.blockHashes[bn]
    return (leftSum, rootSum - rightSum)

COINID_BYTES: constant(int128) = 16
PROOF_MAX_LENGTH: constant(uint256) = 384 # 384 = TREE_NODE_BYTES (48) * MAX_TREE_DEPTH (8) 
ENCODING_LENGTH_PER_TRANSFER: constant(int128) = 165
@public #todo make private once tested
def checkTXValidityAndGetTransfer(
        transferIndex: int128,
        transactionEncoding: bytes[165], # this will eventually be MAX_TRANSFERS * (SIG_BYTES + TRANSFER_BYTES) + small constant for encoding blockNumber and numTransfers
        parsedSums: bytes[64],  #COINID_BYTES * MAX_TRANSFERS (4)
        leafIndices: bytes[4], #MAX_TRANSFERS * MAX_TREE_DEPTH / 8
        proofs: bytes[1536] #TREE_NODE_BYTES (48) * MAX_TREE_DEPTH (8) * MAX_TRANSFERS (4)
    ) -> (
        uint256, # transfer.start
        uint256, # transfer.end
        address, # transfer.to
        address, # transfer.from
        uint256 # transaction plasmaBlockNumber
    ):
    leafHash: bytes32 = self.getLeafHash(transactionEncoding)
    plasmaBlockNumber: uint256 = self.decodeBlockNumber(transactionEncoding)

    requestedTransferStart: uint256 # these will be the ones at the trIndex we are being asked about by the exit game
    requestedTransferEnd: uint256
    requestedTransferTo: address
    requestedTransferFrom: address
    numTransfers: int128 = len(transactionEncoding) / ENCODING_LENGTH_PER_TRANSFER
    proofSize: int128 = len(proofs) / numTransfers
    for i in range(MAX_TRANSFERS):
        if i == numTransfers: #loop for max possible transfers, but break so we don't go past
            break

        parsedSum: bytes[16] = slice(parsedSums, start = i * COINID_BYTES, len = COINID_BYTES) # COINID_BYTES = 16
        leafIndex: bytes[1] = slice(leafIndices, start = i * MAX_TREE_DEPTH / 8, len = MAX_TREE_DEPTH / 8) # num bytes is MAX_TREE_DEPTH / 8
        proof: bytes[1536] =  slice(proofs, start = i * proofSize, len = proofSize) # IN PRACTICE, proof will always be much smaller, but type casting in vyper prevents it from compiling at lower vals

        implicitStart: uint256 = 0
        implicitEnd: uint256 = 10000
        (implicitStart, implicitEnd) = self.checkBranchAndGetBounds(
            leafHash,
            parsedSum,
            convert(leafIndex, int128),
            proof,
            plasmaBlockNumber
        )

        transferStart: uint256
        transferEnd: uint256
        (transferStart, transferEnd) = self.decodeIthTransferBounds(i, transactionEncoding)

        assert implicitStart <= transferStart
        assert transferStart < transferEnd
        assert transferEnd <= implicitEnd
        assert implicitEnd <= MAX_END

        # signature: bytes[1] = self.decodeIthSignature(i, transactionEncoding)
        sender: address = self.decodeIthTransferFrom(i, transactionEncoding)
        # TODO: add signature check here!

        if i == transferIndex:
            requestedTransferTo = self.decodeIthTransferTo(i, transactionEncoding)
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

@public
def respondInclusion(
        challengeID: uint256,
        transferIndex: int128,
        transactionEncoding: bytes[100], # this will be MAX_TRANSFERS * (SIG_BYTES + TRANSFER_BYTES) + small constant for encoding blockNumber and numTransfers
        parsedSums: bytes[64],  #COINID_BYTES * MAX_TRANSFERS (4)
        leafIndices: bytes[4], #MAX_TRANSFERS * MAX_TREE_DEPTH / 8
        proofs: bytes[1536] #TREE_NODE_BYTES (58) * MAX_TREE_DEPTH (8) * MAX_TRANSFERS (4)
):
    assert self.inclusionChallenges[challengeID].ongoing

    transferStart: uint256 # these will be the ones at the trIndex we are being asked about by the exit game
    transferEnd: uint256
    transferTo: address
    transferFrom: address
    bn: uint256

 #   (
 #       transferStart, 
 #       transferEnd, 
 #       transferTo, 
 #       transferFrom,
 #       bn
 #   ) = self.checkTXValidityAndGetTransfer(
 #       transferIndex,
 #       transactionEncoding,
 #       parsedSums,
 #       leafIndices,
 #       proofs
 #   )

    exitID: uint256 = self.inclusionChallenges[challengeID].exitID
    exiter: address = self.exits[exitID].exiter
    exitPlasmaBlock: uint256 = self.exits[exitID].plasmaBlock

    # check exit exiter is indeed recipient
    assert transferTo == exiter

    # response was successful
    self.inclusionChallenges[challengeID].ongoing = False
    self.exits[exitID].challengeCount -= 1

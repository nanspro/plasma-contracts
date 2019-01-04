#TODO: always check uints greater than 0

struct Exit:
    owner: address
    plasmaBlock: uint256
    ethBlock: uint256
    start: uint256
    end: uint256
    challengeCount: uint256

struct Challenge:
    exitId: uint256
    ongoing: bool
    token_index: uint256

struct depositedRange:
    end: uint256
    nextDepositStart: uint256

operator: public(address)
deposits: public(map(address, wei_value))
plasmaBlockNumber: public(uint256)
last_publish: public(uint256) # ethereum block number of most recent plasma block
hash_chain: public(map(uint256, bytes32))

depositedRanges: public(map(uint256, depositedRange))

exits: public(map(uint256, Exit))
challenges: public(map(uint256, Challenge))
exit_nonce: public(uint256)
challenge_nonce: public(uint256)

# period (of ethereum blocks) during which an exit can be challenged
CHALLENGE_PERIOD: constant(uint256) = 20
# minimum number of ethereum blocks between new plasma blocks
PLASMA_BLOCK_INTERVAL: constant(uint256) = 10
#
MAX_TREE_DEPTH: constant(uint256) = 8
MAX_END: constant(uint256) = 170141183460469231731687303715884105727

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
def addr_to_bytes(addr: address) -> bytes[20]:
    addr_bytes32: bytes[32] = concat(convert(addr, bytes32), "")
    return slice(addr_bytes32, start=12, len=20)

@public
def plasma_message_hash(
        sender: address,
        recipient: address,
        start: uint256,
        offset: uint256,
) -> bytes32:
    return sha3(concat(
        self.addr_to_bytes(sender),
        self.addr_to_bytes(recipient),
        convert(start, bytes32),
        convert(offset, bytes32),
    ))

@public
def tx_hash(
        sender: address,
        recipient: address,
        start: uint256,
        offset: uint256,
        sig_v: uint256,
        sig_r: uint256,
        sig_s: uint256,
) -> bytes32:
    return sha3(concat(
        self.addr_to_bytes(sender),
        self.addr_to_bytes(recipient),
        convert(start, bytes32),
        convert(offset, bytes32),
        convert(sig_v, bytes32),
        convert(sig_r, bytes32),
        convert(sig_s, bytes32),
    ))

@public
def __init__():
    self.operator = msg.sender
    self.plasmaBlockNumber = 0
    self.exit_nonce = 0
    self.last_publish = 0
    self.challenge_nonce = 0
    self.depositedRanges[0] = depositedRange({end: 0, nextDepositStart: MAX_END})
    self.depositedRanges[MAX_END] = depositedRange({end:MAX_END, nextDepositStart: MAX_END})
    self.depositedRanges[MAX_END+1] = depositedRange({end: MAX_END+1, nextDepositStart: 0}) # this is not really a deposited range (it's beyond then MAX_END bounday) but we need it so we can pass a precedingDeposit to the finalizeExit function.  There, we check if this END+1 was the thing passed and if so we leave it alone

@public
def submitBlock(block_hash: bytes32):
    assert msg.sender == self.operator
    assert block.number >= self.last_publish + PLASMA_BLOCK_INTERVAL

    self.hash_chain[self.plasmaBlockNumber] = block_hash
    self.plasmaBlockNumber += 1
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
        self.depositedRanges[leftDepositStart].end = leftDepositStart + depositAmount

@private
def checkRangeIsExitable(start: uint256, end: uint256, depositStart: uint256):
    #todo check start/end do not exceed bounds and are well-ordered
    assert depositStart <= start
    assert self.depositedRanges[depositStart].end >= end

@public
def beginExit(bn: uint256, start: uint256, end: uint256, depositStart: uint256) -> uint256:
    #todo check doesn't span multiple tokentypes because that would make finalizing exits a hastle (but prob not break any logic...)
    assert bn <= self.plasmaBlockNumber

    self.checkRangeIsExitable(start, end, depositStart)

    en: uint256 = self.exit_nonce
    self.exits[en].owner = msg.sender
    self.exits[en].plasmaBlock = bn
    self.exits[en].ethBlock = block.number
    self.exits[en].start = start
    self.exits[en].end = end
    self.exits[en].challengeCount = 0
    self.exit_nonce += 1
    return en

@public
def finalizeExit(exitId: uint256, precedingDepositStart: uint256) -> uint256: #slightly counterintuitive but we get the deposit slot BEFORE the affected deposit start -- in case we need to update its nextStart reference
    assert block.number >= self.exits[exitId].ethBlock + CHALLENGE_PERIOD
    assert self.exits[exitId].challengeCount == 0

    exitStart: uint256 = self.exits[exitId].start
    exitEnd: uint256 = self.exits[exitId].end


    #oldRange is the deposit range we are exiting from, pre-finalization
    oldRangeStart: uint256 = self.depositedRanges[precedingDepositStart].nextDepositStart

    self.checkRangeIsExitable(exitStart, exitEnd, oldRangeStart) # check again in case an earlier exit was finalized

    oldRange: depositedRange = self.depositedRanges[oldRangeStart]

    # to the right of our exit is a new depositrange, starting at the exit's end, pointing to the original nextDeposit, and ending at the original depositRange end (this might make its start == end if the exit is right-aligned, but that's fine -- it would never pass a checkRangeIsExitable())
    

    self.depositedRanges[exitEnd].end = 13
    self.depositedRanges[exitEnd].nextDepositStart = 14

    return exitEnd

    #self.depositedRanges[exitEnd].end = oldRange.end, 
    #self.depositedRanges[exitEnd].nextDepositStart = oldRange.nextDepositStart


    # to the left of our exit is the old depositrange, but now we give it this a new end positiion of the exit's start.
        
    self.depositedRanges[oldRangeStart].end = exitStart

    if oldRange.end == exitEnd: #if the exit *was* right-aligned (and therefore the depositRange from the prev line is "empty"--see above)...
        self.depositedRanges[oldRangeStart].nextDepositStart = oldRange.nextDepositStart # (cont) ...then we need to point to the original nextStart, *not* the empty one, so that an exit can be done on the full range at once
    else: 
        self.depositedRanges[oldRangeStart].nextDepositStart =  exitEnd # otherwise it was not and we point to the end of our exit
    # the AND below is if we're using the "out of range" preceding deposit to point to the oldRange, because in that case we don't wanna merge the ranges.  we could also add a bool input to finalize exit but this is cleaner code-wise
    if oldRangeStart == exitStart and precedingDepositStart != MAX_END + 1: #similarly, if the exit was left-aligned (note: might have been both!) ...
        self.depositedRanges[precedingDepositStart].nextDepositStart = self.depositedRanges[oldRangeStart].nextDepositStart # then the preceding range must point to whatever the we decided the affectedDeposit points to in the above if statement.

    send(self.exits[exitId].owner, as_wei_value(exitEnd - exitStart, 'wei'))

@public
def challenge_completeness(
        exitId: uint256,
        token_index: uint256,
) -> uint256:
    # check the exit being challenged exists
    assert exitId < self.exit_nonce

    # check the token index being challenged is in the range being exited
    assert token_index >= self.exits[exitId].start
    assert token_index < self.exits[exitId].end

    # store challenge
    cn: uint256 = self.challenge_nonce
    self.challenges[cn].exitId = exitId
    self.challenges[cn].ongoing = True
    self.challenges[cn].token_index = token_index
    self.exits[exitId].challengeCount += 1

    self.challenge_nonce += 1
    return cn

@public
def respond_completeness(
        challenge_id: uint256,
        sender: address,
        recipient: address,
        start: uint256,
        offset: uint256,
        sig_v: uint256,
        sig_r: uint256,
        sig_s: uint256,
        proof: bytes32[8],
):
    assert self.challenges[challenge_id].ongoing == True

    exitId: uint256 = self.challenges[challenge_id].exitId
    exit_owner: address = self.exits[exitId].owner
    exit_plasmaBlock: uint256 = self.exits[exitId].plasmaBlock
    challenged_index: uint256 = self.challenges[challenge_id].token_index

    # compute message hash
    message_hash: bytes32 = self.plasma_message_hash(sender, recipient, start, offset)

    # check transaction is signed correctly
    addr: address = ecrecover(message_hash, sig_v, sig_r, sig_s)
    assert addr == sender

    # check exit owner is indeed recipient
    assert recipient == exit_owner

    # check transaction covers challenged index
    assert challenged_index >= start
    assert challenged_index < (start + offset)

    # check transaction was included in plasma block hash
    root: bytes32 = self.tx_hash(
        sender,
        recipient,
        start,
        offset,
        sig_v,
        sig_r,
        sig_s,
    )
    for i in range(8):
        if convert(proof[i], uint256) == 0:
            break
        root = sha3(concat(root, proof[i]))
    assert root == self.hash_chain[exit_plasmaBlock]

    # response was successful
    self.challenges[challenge_id].ongoing = False
    self.exits[exitId].challengeCount -= 1

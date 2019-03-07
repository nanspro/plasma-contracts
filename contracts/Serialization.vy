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
@constant
def getLeafHash(transactionEncoding: bytes[277]) -> bytes32:
    return sha3(transactionEncoding)

# decode(BlockNumber,0,uint256)
@public
@constant
def decodeBlockNumber(transactionEncoding: bytes[277]) -> uint256:
    num: bytes[4] = slice(transactionEncoding, start = 0, len = 4)
    return convert(num, uint256)

# decode(NumTransfers,1,uint256)
@public
@constant
def decodeNumTransfers(transactionEncoding: bytes[277]) -> uint256:
    num: bytes[1] = slice(transactionEncoding, start = 4, len = 1)
    return convert(num, uint256)

FIRST_TR_START: constant(int128) = 5
TR_LEN: constant(int128) = 68
@public
@constant
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

@public
@constant
def bytes20ToAddress(addr: bytes[20]) -> address:
    padded: bytes[52] = concat(EMPTY_BYTES32, addr)
    return convert(convert(slice(padded, start=20, len=32), bytes32), address)

# decode(Sender,2,address,1)
@public
@constant
def decodeSender(transferEncoding: bytes[68]) -> address:
    num: bytes[20] = slice(transferEncoding, start = 0, len = 20)
    return self.bytes20ToAddress(num)

# decode(Recipient,3,address,1)
@public
@constant
def decodeRecipient(transferEncoding: bytes[68]) -> address:
    num: bytes[20] = slice(transferEncoding, start = 20, len = 20)
    return self.bytes20ToAddress(num)

# decode(TokenTypeBytes,4,bytes[4],1)
@public
@constant
def decodeTokenTypeBytes(transferEncoding: bytes[68]) -> bytes[4]:
    num: bytes[4] = slice(transferEncoding, start = 40, len = 4)
    return num
# decode(TokenType,4,uint256,1)
@public
@constant
def decodeTokenType(transferEncoding: bytes[68]) -> uint256:
    num: bytes[4] = self.decodeTokenTypeBytes(transferEncoding)
    return convert(num, uint256)

@public
@constant
def getTypedFromTokenAndUntyped(tokenType: uint256, coinID: uint256) -> uint256:
    return coinID + tokenType * (256**12)

TR_UNTYPEDSTART_START: constant(int128) = 44
TR_UNTYPEDSTART_LEN: constant(int128) = 12
TR_UNTYPEDEND_START: constant(int128) = 56
TR_UNTYPEDEND_LEN: constant(int128) = 12
@public
@constant
def decodeTypedTransferRange(
    transferEncoding: bytes[68]
) -> (uint256, uint256): # start, end
    tokenType: bytes[4] = self.decodeTokenTypeBytes(transferEncoding)
    untypedStart: bytes[12] = slice(transferEncoding,
        start = TR_UNTYPEDSTART_START,
        len = TR_UNTYPEDSTART_LEN)
    untypedEnd: bytes[12] = slice(transferEncoding,
        start = TR_UNTYPEDEND_START,
        len = TR_UNTYPEDEND_LEN)
    return (
        convert(concat(tokenType, untypedStart), uint256),
        convert(concat(tokenType, untypedEnd), uint256)
    )

### BEGIN TRANSFERPROOF DECODING SECTION ###

# Note on TransferProofEncoding size:
# It will always really be at most 
# PARSED_SUM_LEN + LEAF_INDEX_LEN + ADDRESS_LEN + PROOF_COUNT_LEN + MAX_TREE_DEPTH * TREENODE_LEN
# = 16 + 16 + 20 + 1 + 24 * 48 = 1205
# but because of dumb type casting in vyper, it thinks it *might* 
# be larger because we slice the TX encoding to get it.  So it has to be
# TRANSFERPROOF_COUNT_LEN + 1205 * MAX_TRANSFERS = 1 + 1205 * 4 = 4821

TREENODE_LEN: constant(int128) = 48

# decode(ParsedSumBytes,5,bytes[16],2)
@public
@constant
def decodeParsedSumBytes(transferProofEncoding: bytes[1749]) -> bytes[16]:
    num: bytes[16] = slice(transferProofEncoding, start = 0, len = 16)
    return num
# decode(LeafIndex,6,int128,2)
@public
@constant
def decodeLeafIndex(transferProofEncoding: bytes[1749]) -> int128:
    num: bytes[16] = slice(transferProofEncoding, start = 16, len = 16)
    return convert(num, int128)

SIG_START:constant(int128) = 32
SIGV_OFFSET: constant(int128) = 0
SIGV_LEN: constant(int128) = 1
SIGR_OFFSET: constant(int128) = 1
SIGR_LEN: constant(int128) = 32
SIGS_OFFSET: constant(int128) = 33
SIGS_LEN: constant(int128) = 32
@public
@constant
def decodeSignature(
    transferProofEncoding: bytes[1749]
) -> (
    uint256, # v
    uint256, # r
    uint256 # s
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
        convert(sigV, uint256),
        convert(sigR, uint256),
        convert(sigS, uint256)
    )

# decode(NumInclusionProofNodesFromTRProof,7,int128,2)
@public
@constant
def decodeNumInclusionProofNodesFromTRProof(transferProofEncoding: bytes[1749]) -> int128:
    num: bytes[1] = slice(transferProofEncoding, start = 97, len = 1)
    return convert(num, int128)

INCLUSIONPROOF_START: constant(int128) = 98
@public
@constant
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
@constant
def decodeNumInclusionProofNodesFromTXProof(transactionProof: bytes[1749]) -> int128:
    firstTransferProof: bytes[98] = slice(
        transactionProof,
        start = FIRST_TRANSFERPROOF_START,
        len = 98 # + 1 so we include the numNodes
    )
    return self.decodeNumInclusionProofNodesFromTRProof(firstTransferProof)


# decode(NumTransactionProofs,8,int128,2)
@public
@constant
def decodeNumTransactionProofs(transferProofEncoding: bytes[1749]) -> int128:
    num: bytes[1] = slice(transferProofEncoding, start = 0, len = 1)
    return convert(num, int128)

@public
@constant
def decodeIthTransferProofWithNumNodes(
    index: int128,
    numInclusionProofNodes: int128,
    transactionProofEncoding: bytes[1749]
) -> bytes[1749]:
    transactionProofLen: int128 = (
        #PARSEDSUM_LEN + #16
        #LEAFINDEX_LEN + #16
        #SIGS_LEN + SIGV_LEN + SIGR_LEN + # 65
        #NUMPROOFNODES_LEN + #1
        98 + TREENODE_LEN * numInclusionProofNodes
    )
    transferProof: bytes[1749] = slice(
        transactionProofEncoding,
        start = index * transactionProofLen + FIRST_TRANSFERPROOF_START,
        len = transactionProofLen
    )
    return transferProof

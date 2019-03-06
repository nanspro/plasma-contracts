const fs = require('fs')
const path = './contracts/Serialization.vy'

var schemas = []
var encoding = ['(transactionEncoding: bytes[277]) -> ', '(transferEncoding: bytes[68]) -> ', '(transferProofEncoding: bytes[1749]) -> ']
schemas.push({
  start: 0,
  len: 4
})
schemas.push({
  start: 4,
  len: 1
})
schemas.push({
  start: 0,
  len: 20
})

schemas.push({
  start: 20,
  len: 20
})

schemas.push({
  start: 40,
  len: 4
})

schemas.push({
  start: 0,
  len: 16
})

schemas.push({
  start: 16,
  len: 16
})

schemas.push({
  start: 97,
  len: 1
})

schemas.push({
  start: 0,
  len: 1
})

function getFunc (name, fieldId, returnType, encodingIdx = 0) {
  var line = '\r\n'
  var text, input
  text = '@public' + line + '@constant' + line
  input = encoding[encodingIdx]
  text += 'def decode' + name + input + returnType + ':' + line
  
  if (encodingIdx == 1) {
    if (returnType == 'uint256') {
      text += '    num: bytes[4] = self.decodeTokenTypeBytes(transferEncoding)' + line
    }
    else {
      text += '    num: bytes[' + schemas[fieldId].len + '] = slice(transferEncoding, start = ' + schemas[fieldId].start + ', len = ' + schemas[fieldId].len + ')' + line
    }
  }
  else if (encodingIdx == 2) {
    text += '    num: bytes[' + schemas[fieldId].len + '] = slice(transferProofEncoding, start = ' + schemas[fieldId].start + ', len = ' + schemas[fieldId].len + ')' + line
  }
  else if (encodingIdx == 0) {
    text += '    num: bytes[' + schemas[fieldId].len + '] = slice(transactionEncoding, start = ' + schemas[fieldId].start + ', len = ' + schemas[fieldId].len + ')' + line
  }
  
  if (returnType == 'uint256' || returnType == 'int128') {
    x = 'convert(num, ' + returnType+ ')'  + line
  }
  if (returnType == 'address') {
    x = 'self.bytes20ToAddress(num)'  + line
  }
  if (returnType == 'bytes[4]' || returnType == 'bytes[16]') {
    x = 'num'
  }
  text += '    return '+ x + line
  return text
}

function getReplaceData(text){
  console.log(text)
  var data = text
  var idx, name, fieldId, returnType
  var encodingIdx = 0
  console.log('hi')
  idx = 9
  name = ''
  while (data[idx] != ',') {
    name += data[idx]
    idx++
  }
  idx++
  fieldId = data[idx]
  returnType = ''
  idx += 2
  while (data[idx] != ',' && data[idx] != ')') {
    returnType += data[idx]
    idx++
  }

  idx++
  if (data[idx] != '}') {
    encodingIdx = data[idx]
    idx += 2
  }
  return getFunc(name, fieldId, returnType, encodingIdx)
}

var data = fs.readFileSync(path, 'utf-8')
var y = ''
for (var j = 0; j < data.length - 1; j++) {
  if (data[j] == '$' && data[j + 1] == '{') {
    k = j
    var text = ''
    while(data[k] != '}'){
      text += data[k]
      k++
    }
    text += '}'
    var newData = getReplaceData(text)
    for (var o = 0; o < newData.length - 1; o++) {
      y += newData[o]
      // data.replace(text, newData)
    }
    j = k + 1
  }
  else{
    y += data[j]
  }
}
fs.writeFileSync(path, y)

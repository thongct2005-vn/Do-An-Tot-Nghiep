const crypto = require("crypto");

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function generateReferenceCode(length = 12) {
  const bytes = crypto.randomBytes(length);
  //For example: 4a -> 4*16 + (a:10, b:11,....) = 74 % ALPHABET.length:57 = 17-> T
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return code;
}

module.exports = { generateReferenceCode };

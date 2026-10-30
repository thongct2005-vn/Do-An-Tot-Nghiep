function maskEmail(email) {
  const at = email.lastIndexOf("@");
  const name = email.slice(0, at);
  const domain = email.slice(at + 1);
  const len = name.length;

  if (len <= 4) return email;

  const head = len > 6 ? 3 : 2;
  const tail = len > 6 ? 3 :2
  return `${name.slice(0, head)}***${name.slice(-tail)}@${domain}`;
}

function maskPhone(phone) {
  if (!phone) return null;
  return phone.length >= 3 ? `*********${phone.slice(-3)}` : phone;
}

function maskAccountNumber(accountNumber) {
  if (!accountNumber) return null;
  const str = String(accountNumber);
  return str.length > 4 ? `${"*".repeat(str.length - 4)}${str.slice(-4)}` : str;
}

module.exports = { maskEmail, maskPhone, maskAccountNumber };

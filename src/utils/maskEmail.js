function maskEmail(email) {
  const at = email.lastIndexOf("@");
  const name = email.slice(0, at);
  const domain = email.slice(at + 1);
  const len = name.length;

  if (len <= 4) return email;

  const head = len > 6 ? 3 : 2;
  return `${name.slice(0, head)}***${name.slice(-1)}@${domain}`;
}

module.exports = { maskEmail };

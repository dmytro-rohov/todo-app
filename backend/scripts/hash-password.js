// Prints an ADMIN_PASSWORD_HASH (or AUTH_PASSWORD_HASH) value with Tasks' scrypt parameters (kit.js). Reads the password
// from stdin so it never appears in process arguments or shell history:
//   node scripts/hash-password.js < password.txt
//   printf '%s' "$PASSWORD" | docker run --rm -i <image> node backend/scripts/hash-password.js
require("../kit").hashPasswordCli();

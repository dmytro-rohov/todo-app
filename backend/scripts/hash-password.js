// Prints an AUTH_PASSWORD_HASH value. Reads the password from stdin so it
// never appears in process arguments or shell history:
//   node scripts/hash-password.js < password.txt
//   printf '%s' "$PASSWORD" | docker run --rm -i <image> node backend/scripts/hash-password.js
const { hashPassword } = require("../security");

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const password = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");

  if (password.length < 12) {
    console.error("Password must be at least 12 characters");
    process.exit(1);
  }

  console.log(await hashPassword(password));
}

main();

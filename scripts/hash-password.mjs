import { hashPassword } from "../server/auth.mjs";

let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;
const password = input.replace(/[\r\n]+$/, "");
process.stdout.write(`${hashPassword(password)}\n`);

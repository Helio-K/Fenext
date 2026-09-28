import { spawn } from "node:child_process";
const children = [
  ["node", ["--watch", "server/index.mjs"]],
  ["node", ["--watch", "server/worker.mjs"]],
  ["npm", ["exec", "vite"]],
].map(([c, args]) => spawn(c, args, { stdio: "inherit", env: process.env }));
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const c of children)
  c.on("exit", () => {
    if (!stopping) stop();
  });

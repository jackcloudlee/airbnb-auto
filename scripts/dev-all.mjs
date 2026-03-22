import { spawn } from "node:child_process";

const children = [];
let shuttingDown = false;

function start(name, command, args) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: false,
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;

    const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    console.error(`[${name}] exited with ${reason}`);
    shutdown(typeof code === "number" ? code : 1);
  });

  children.push(child);
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }
    process.exit(exitCode);
  }, 1000).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

start("server", "npm", ["run", "server"]);
start("client", "npm", ["run", "dev"]);

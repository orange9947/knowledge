import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const [, , moduleName, cwdArg = ".", ...moduleArgs] = process.argv;

if (!moduleName) {
  console.error("Usage: node scripts/run-python-module.mjs <module> [cwd] [...args]");
  process.exit(2);
}

const rootDir = resolve(import.meta.dirname, "..");
const cwd = resolve(rootDir, cwdArg);
const candidates = [];

function add(command, prefixArgs = []) {
  candidates.push({ command, prefixArgs });
}

if (process.env.PYTHON) add(process.env.PYTHON);

if (process.env.pythonLocation) {
  add(
    process.platform === "win32"
      ? join(process.env.pythonLocation, "python.exe")
      : join(process.env.pythonLocation, "bin", "python"),
  );
}

if (process.platform === "win32") {
  add(join(rootDir, ".venv", "Scripts", "python.exe"));
  add("py", ["-3"]);
  add("python");
} else {
  add(join(rootDir, ".venv", "bin", "python"));
  add("python3");
  add("python");
}

for (const candidate of candidates) {
  if (candidate.command.includes("/") || candidate.command.includes("\\")) {
    if (!existsSync(candidate.command)) continue;
  }

  const result = spawnSync(
    candidate.command,
    [...candidate.prefixArgs, "-m", moduleName, ...moduleArgs],
    {
      cwd,
      stdio: "inherit",
      shell: false,
      env: process.env,
    },
  );

  if (result.error?.code === "ENOENT") continue;
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  process.exit(result.status ?? 0);
}

console.error("No usable Python interpreter found. Create .venv or set PYTHON.");
process.exit(1);

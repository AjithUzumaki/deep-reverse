import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
import { platform } from "node:os";
import { promises as fs } from "node:fs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.DEEP_REVERSE_LOCAL_AGENT_PORT || 8765);
if (platform() !== "win32") {
  console.error("The DEEP REVERSE local agent must run on Windows to access Windows folders and PowerShell.");
  process.exit(1);
}
const allowedOrigins = new Set(
  (process.env.DEEP_REVERSE_LOCAL_AGENT_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const pairingCode = randomBytes(24).toString("hex");
const sessionToken = randomBytes(32).toString("base64url");
let paired = false;
let pairingConsumed = false;
let workspaceRoot = null;
let runningCommand = false;

const ignoredNames = new Set([
  ".git", ".next", ".turbo", ".cache", "node_modules", "vendor", "dist", "build",
  ".venv", "venv", "__pycache__", ".idea", ".vscode", "coverage",
]);
const secretFilePattern = /(^\.env($|\.)|\.env$|(^|[._-])(id_rsa|id_ed25519|credentials?|secret|token|password|passwd|api[_-]?key)([._-]|$)|\.(pem|key|p12|pfx|keystore|jks)$)/i;
const specialTextNames = new Set([".gitignore", ".dockerignore", "dockerfile", "makefile", ".editorconfig"]);
const textExtensions = new Set([
  ".txt", ".md", ".mdx", ".html", ".htm", ".css", ".scss", ".js", ".jsx", ".mjs", ".cjs",
  ".ts", ".tsx", ".json", ".jsonc", ".yaml", ".yml", ".toml", ".xml", ".svg", ".py", ".pyi",
  ".ps1", ".psm1", ".psd1", ".sh", ".bat", ".cmd", ".sql", ".go", ".rs", ".java", ".kt",
  ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".rb", ".swift", ".vue", ".svelte", ".gitignore",
  ".conf", ".ini", ".properties",
]);

function isEditableTextFile(name) {
  return specialTextNames.has(name.toLowerCase()) || textExtensions.has(extname(name).toLowerCase());
}

function isWithinRoot(root, target) {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function json(res, status, value, origin) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...(origin && allowedOrigins.has(origin) ? {
      "Access-Control-Allow-Origin": origin,
      "Vary": "Origin",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    } : {}),
  });
  res.end(body);
}

function readBody(req, limit = 1_100_000) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("Request body is too large."), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON."), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function authorized(req) {
  if (!paired) return false;
  const supplied = Buffer.from((req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(sessionToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function setWorkspace(selectedPath) {
  const candidate = await fs.realpath(selectedPath);
  const stat = await fs.stat(candidate);
  if (!stat.isDirectory()) throw Object.assign(new Error("Choose a folder, not a file."), { status: 400 });
  workspaceRoot = candidate;
  return workspaceDetails();
}

function workspaceDetails() {
  return workspaceRoot ? { name: workspaceRoot.split(/[\\/]/).filter(Boolean).at(-1), path: workspaceRoot } : null;
}

async function getSafePath(relativePath = "", { mustExist = true, directory = false } = {}) {
  if (!workspaceRoot) throw Object.assign(new Error("Choose a project folder first."), { status: 409 });
  if (typeof relativePath !== "string" || relativePath.includes("\0") || isAbsolute(relativePath) || win32.isAbsolute(relativePath) || /^[a-z]:/i.test(relativePath)) {
    throw Object.assign(new Error("Use a path relative to the selected project folder."), { status: 400 });
  }
  const root = await fs.realpath(workspaceRoot);
  const target = resolve(root, relativePath || ".");
  if (!isWithinRoot(root, target)) throw Object.assign(new Error("That path is outside the selected project folder."), { status: 403 });

  let resolvedTarget = target;
  if (mustExist) {
    resolvedTarget = await fs.realpath(target);
    if (!isWithinRoot(root, resolvedTarget)) throw Object.assign(new Error("That path resolves outside the selected project folder."), { status: 403 });
    const stat = await fs.stat(resolvedTarget);
    if (directory && !stat.isDirectory()) throw Object.assign(new Error("That path is not a folder."), { status: 400 });
    if (!directory && !stat.isFile()) throw Object.assign(new Error("That path is not a file."), { status: 400 });
  } else {
    const realParent = await fs.realpath(dirname(target));
    if (!isWithinRoot(root, realParent)) throw Object.assign(new Error("That path resolves outside the selected project folder."), { status: 403 });
    resolvedTarget = join(realParent, target.split(/[\\/]/).at(-1));
    try {
      const realTarget = await fs.realpath(resolvedTarget);
      if (!isWithinRoot(root, realTarget)) throw Object.assign(new Error("That path resolves outside the selected project folder."), { status: 403 });
      if ((await fs.stat(realTarget)).isDirectory()) throw Object.assign(new Error("Choose a file path."), { status: 400 });
      resolvedTarget = realTarget;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return { root, path: resolvedTarget, relativePath: relative(root, resolvedTarget).split(sep).join("/") };
}

function shouldHide(name) {
  return ignoredNames.has(name.toLowerCase()) || secretFilePattern.test(name);
}

async function listDirectory(relativePath = "") {
  const { root, path: folder, relativePath: normalizedPath } = await getSafePath(relativePath, { directory: true });
  const entries = await fs.readdir(folder, { withFileTypes: true });
  const visible = entries
    .filter((entry) => !shouldHide(entry.name) && !entry.isSymbolicLink())
    .map((entry) => ({
      name: entry.name,
      path: [normalizedPath, entry.name].filter(Boolean).join("/"),
      type: entry.isDirectory() ? "directory" : "file",
      editable: entry.isFile() && isEditableTextFile(entry.name),
    }))
    .sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1);
  return { root: { name: root.split(/[\\/]/).filter(Boolean).at(-1), path: root }, path: normalizedPath, entries: visible.slice(0, 500) };
}

async function readTextFile(relativePath) {
  const name = relativePath.split(/[\\/]/).at(-1) || "";
  if (shouldHide(name)) throw Object.assign(new Error("This file is excluded because it may contain secrets."), { status: 403 });
  if (!isEditableTextFile(name)) throw Object.assign(new Error("This file type is not enabled for text editing."), { status: 415 });
  const { path, relativePath: normalizedPath } = await getSafePath(relativePath);
  const stat = await fs.stat(path);
  if (stat.size > 700_000) throw Object.assign(new Error("This file is larger than the 700 KB editor limit."), { status: 413 });
  const content = await fs.readFile(path, "utf8");
  if (content.includes("\0")) throw Object.assign(new Error("Binary files cannot be opened in the editor."), { status: 415 });
  return { path: normalizedPath, content, size: stat.size };
}

async function importProjectFile(relativeDirectory, name, contentBase64) {
  if (typeof name !== "string" || !name.trim() || name.length > 255 || name === "." || name === ".." || /[\\/\0]/.test(name)) {
    throw Object.assign(new Error("Choose a single file name without a folder path."), { status: 400 });
  }
  if (shouldHide(name)) throw Object.assign(new Error("Files that may contain secrets or generated dependencies cannot be imported."), { status: 403 });
  if (typeof contentBase64 !== "string" || contentBase64.length > 20_972_000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(contentBase64)) {
    throw Object.assign(new Error("The selected file could not be read or exceeds the 15 MB import limit."), { status: 413 });
  }
  const bytes = Buffer.from(contentBase64, "base64");
  if (bytes.length > 15 * 1024 * 1024) throw Object.assign(new Error("Files must be smaller than 15 MB."), { status: 413 });
  const destination = [relativeDirectory, name].filter(Boolean).join("/");
  const { path, relativePath } = await getSafePath(destination, { mustExist: false });
  await fs.writeFile(path, bytes, { flag: "wx" });
  return {
    path: relativePath,
    size: bytes.length,
    editable: isEditableTextFile(basename(name)) && bytes.length <= 700_000,
  };
}

async function runPowerShell(command, relativeDirectory, timeoutMs) {
  if (runningCommand) throw Object.assign(new Error("A PowerShell command is already running."), { status: 409 });
  if (platform() !== "win32") throw Object.assign(new Error("The local agent must run on Windows to launch Windows PowerShell."), { status: 501 });
  const { root, path: workingDirectory } = await getSafePath(relativeDirectory || "", { directory: true });
  if (!isWithinRoot(root, workingDirectory)) {
    throw Object.assign(new Error("The working directory must stay inside the selected project folder."), { status: 403 });
  }
  if (typeof command !== "string" || !command.trim() || command.length > 8000) {
    throw Object.assign(new Error("Enter a PowerShell command up to 8,000 characters."), { status: 400 });
  }

  return new Promise((resolveResult, reject) => {
    runningCommand = true;
    const startedAt = Date.now();
    const safeDirectory = workingDirectory.replace(/'/g, "''");
    const script = `$ErrorActionPreference = 'Stop'\n[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()\n$OutputEncoding = [System.Text.UTF8Encoding]::new()\ntry {\nSet-Location -LiteralPath '${safeDirectory}'\n${command}\nif ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }\nexit 0\n} catch { [Console]::Error.WriteLine($_.ToString()); exit 1 }`;
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const safeEnvironment = new Set([
      "PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
      "APPDATA", "LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "COMMONPROGRAMFILES",
      "COMSPEC", "PATHEXT", "PSMODULEPATH",
    ]);
    const childEnvironment = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => safeEnvironment.has(name.toUpperCase())),
    );
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
      cwd: workingDirectory,
      windowsHide: true,
      env: childEnvironment,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const append = (current, chunk) => (current + chunk.toString("utf8")).slice(-120_000);
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, Math.max(1000, Math.min(timeoutMs || 30000, 30000)));
    child.on("error", (error) => {
      clearTimeout(timer);
      runningCommand = false;
      reject(Object.assign(new Error(`Could not start PowerShell: ${error.message}`), { status: 500 }));
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      runningCommand = false;
      resolveResult({
        command,
        working_directory: relative(root, workingDirectory).split(sep).join("/"),
        stdout,
        stderr,
        exit_code: timedOut ? 124 : (exitCode ?? 1),
        timed_out: timedOut,
        duration_ms: Date.now() - startedAt,
        truncated: stdout.length >= 120_000 || stderr.length >= 120_000,
      });
    });
  });
}

async function chooseFolder() {
  if (platform() !== "win32") throw Object.assign(new Error("The folder picker is available when the local agent runs on Windows."), { status: 501 });
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$OutputEncoding = [System.Text.UTF8Encoding]::new()",
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$dialog.Description = 'Choose the project folder DEEP REVERSE may access'",
    "$dialog.ShowNewFolderButton = $false",
    "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::WriteLine($dialog.SelectedPath) }",
  ].join("; ");
  const selectedPath = await new Promise((resolvePicker, reject) => {
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-Sta", "-Command", script], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => reject(new Error(`Could not open the Windows folder picker: ${error.message}`)));
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr.trim() || "The folder picker did not open."));
      else resolvePicker(stdout.trim());
    });
  });
  if (!selectedPath) return null;
  return setWorkspace(selectedPath);
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  const hostHeader = (req.headers.host || "").toLowerCase();
  if (hostHeader && ![`${HOST}:${PORT}`, `localhost:${PORT}`].includes(hostHeader)) {
    json(res, 403, { error: "Invalid local host header." }, origin);
    return;
  }
  if (origin && !allowedOrigins.has(origin)) {
    json(res, 403, { error: "This website is not allowed to use the local workspace agent." });
    return;
  }
  if (req.method === "OPTIONS") {
    if (!origin || !allowedOrigins.has(origin)) {
      res.writeHead(403);
      res.end();
      return;
    }
    res.writeHead(204, {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Max-Age": "600",
      "Vary": "Origin",
    });
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
  try {
    if (req.method === "GET" && url.pathname === "/v1/status") {
      json(res, 200, { available: true, paired: Boolean(authorized(req)), workspace: authorized(req) ? workspaceDetails() : null }, origin);
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/pair") {
      const body = await readBody(req, 2000);
      const supplied = Buffer.from(String(body.code || ""));
      const expected = Buffer.from(pairingCode);
      if (pairingConsumed || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        json(res, 401, { error: "Pairing code is invalid or expired. Copy the current code from PowerShell, or restart the local agent for a new code." }, origin);
        return;
      }
      pairingConsumed = true;
      paired = true;
      json(res, 200, { token: sessionToken }, origin);
      return;
    }
    if (!authorized(req)) {
      json(res, 401, { error: "Pair the app with the local agent first." }, origin);
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/workspace/pick") {
      const workspace = await chooseFolder();
      json(res, 200, { workspace }, origin);
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/workspace") {
      const body = await readBody(req, 4000);
      if (typeof body.path !== "string" || !isAbsolute(body.path)) {
        json(res, 400, { error: "Choose an absolute folder path." }, origin);
        return;
      }
      json(res, 200, { workspace: await setWorkspace(body.path) }, origin);
      return;
    }
    if (req.method === "GET" && url.pathname === "/v1/files") {
      json(res, 200, await listDirectory(url.searchParams.get("path") || ""), origin);
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/file/read") {
      const body = await readBody(req, 4000);
      json(res, 200, await readTextFile(String(body.path || "")), origin);
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/file/import") {
      const body = await readBody(req, 21_000_000);
      json(res, 201, await importProjectFile(String(body.directory || ""), body.name, body.content_base64), origin);
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/file/write") {
      const body = await readBody(req);
      if (typeof body.content !== "string" || body.content.length > 700_000) {
        json(res, 413, { error: "File content must be text no larger than 700 KB." }, origin);
        return;
      }
      const name = String(body.path || "").split(/[\\/]/).at(-1) || "";
      if (shouldHide(name)) {
        json(res, 403, { error: "The local agent does not edit files that may contain secrets." }, origin);
        return;
      }
      const { path, relativePath } = await getSafePath(String(body.path || ""), { mustExist: false });
      if (!isEditableTextFile(name)) {
        json(res, 415, { error: "This file type is not enabled for text editing." }, origin);
        return;
      }
      if (body.create_only) {
        try {
          await fs.access(path);
          json(res, 409, { error: "That file already exists." }, origin);
          return;
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
      await fs.writeFile(path, body.content, { encoding: "utf8", flag: body.create_only ? "wx" : "w" });
      json(res, 200, { path: relativePath, saved: true, bytes: Buffer.byteLength(body.content) }, origin);
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/terminal/run") {
      const body = await readBody(req, 12_000);
      json(res, 200, await runPowerShell(body.command, String(body.directory || ""), Number(body.timeout_ms || 30000)), origin);
      return;
    }
    json(res, 404, { error: "Local workspace endpoint not found." }, origin);
  } catch (error) {
    json(res, Number(error?.status) || 500, { error: error?.message || "Local workspace request failed." }, origin);
  }
});

server.headersTimeout = 10_000;
server.requestTimeout = 35_000;
server.listen(PORT, HOST, () => {
  console.log("DEEP REVERSE local workspace agent is running on this computer.");
  console.log(`Local API: http://${HOST}:${PORT}`);
  console.log(`One-time pairing code: ${pairingCode}`);
  console.log("Network access is disabled; the service only listens on 127.0.0.1.");
  console.log("PowerShell commands run as your Windows user and require a separate Run click in the app.");
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

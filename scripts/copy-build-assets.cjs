const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const srcBuiltin = path.join(root, "src", "skills", "builtin");
const distBuiltin = path.join(root, "dist", "skills", "builtin");
const lockPath = path.join(root, "src", "config", "skills.lock.json");

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
const verified = new Set(
    Object.entries(lock.skills || {})
        .filter(([, meta]) => meta && meta.commitSha)
        .map(([id]) => id),
);

fs.rmSync(distBuiltin, { recursive: true, force: true });
fs.mkdirSync(distBuiltin, { recursive: true });

for (const entry of fs.readdirSync(srcBuiltin, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!verified.has(entry.name)) continue;
    copyDir(path.join(srcBuiltin, entry.name), path.join(distBuiltin, entry.name));
}

// Copy lock manifest to dist/config for runtime policy checks.
const distConfig = path.join(root, "dist", "config");
fs.mkdirSync(distConfig, { recursive: true });
fs.copyFileSync(lockPath, path.join(distConfig, "skills.lock.json"));

console.log(`Copied ${verified.size} verified skills to ${distBuiltin}`);

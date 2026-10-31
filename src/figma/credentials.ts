import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
// FigmaClient is not imported here to avoid circular dependency

const CREDENTIAL_DIR = join(homedir(), ".node-cli", "credentials");
const CREDENTIAL_FILE = join(CREDENTIAL_DIR, "figma.enc");
const CREDENTIAL_SERVICE = "node-cli-figma";

export interface CredentialStatus {
  available: boolean;
  source: "environment" | "stored" | "none";
  masked?: string;
}

/**
 * Check if Windows DPAPI is available.
 */
function isDpapiAvailable(): boolean {
  if (process.platform !== "win32") return false;
  try {
    execSync("powershell -Command \"[System.Security.Cryptography.ProtectedData]::Protect([byte[]]@(1), $null, 'CurrentUser')\"", {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Encrypt a token using Windows DPAPI.
 */
function encryptToken(token: string): string | null {
  if (!isDpapiAvailable()) return null;
  try {
    const script = `
      $bytes = [System.Text.Encoding]::UTF8.GetBytes('${token.replace(/'/g, "''")}')
      $encrypted = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'CurrentUser')
      [Convert]::ToBase64String($encrypted)
    `;
    const result = execSync(`powershell -Command "${script.replace(/\n/g, " ")}"`, {
      encoding: "utf8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.trim();
  } catch {
    return null;
  }
}

/**
 * Decrypt a token using Windows DPAPI.
 */
function decryptToken(encrypted: string): string | null {
  if (!isDpapiAvailable()) return null;
  try {
    const script = `
      $encrypted = [Convert]::FromBase64String('${encrypted}')
      $decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, 'CurrentUser')
      [System.Text.Encoding]::UTF8.GetString($decrypted)
    `;
    const result = execSync(`powershell -Command "${script.replace(/\n/g, " ")}"`, {
      encoding: "utf8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.trim();
  } catch {
    return null;
  }
}

/**
 * Mask a token for display (show first 4 and last 4 chars).
 */
export function maskToken(token: string): string {
  if (token.length <= 8) return "****";
  return token.slice(0, 4) + "..." + token.slice(-4);
}

/**
 * Get credential status.
 */
export function getCredentialStatus(): CredentialStatus {
  // Environment variables take precedence
  const envToken = process.env.FIGMA_ACCESS_TOKEN || process.env.FIGMA_TOKEN;
  if (envToken) {
    return { available: true, source: "environment", masked: maskToken(envToken) };
  }

  // Check stored credentials
  if (existsSync(CREDENTIAL_FILE)) {
    const encrypted = readFileSync(CREDENTIAL_FILE, "utf8").trim();
    const token = decryptToken(encrypted);
    if (token) {
      return { available: true, source: "stored", masked: maskToken(token) };
    }
  }

  return { available: false, source: "none" };
}

/**
 * Get the Figma access token from any source.
 */
export function getFigmaToken(): string | null {
  // Environment variables take precedence
  const envToken = process.env.FIGMA_ACCESS_TOKEN || process.env.FIGMA_TOKEN;
  if (envToken) return envToken;

  // Check stored credentials
  if (existsSync(CREDENTIAL_FILE)) {
    const encrypted = readFileSync(CREDENTIAL_FILE, "utf8").trim();
    return decryptToken(encrypted);
  }

  return null;
}

/**
 * Store a Figma token securely.
 * Returns true if stored successfully, false if secure storage unavailable.
 */
export function storeFigmaToken(token: string): boolean {
  if (!isDpapiAvailable()) return false;

  const encrypted = encryptToken(token);
  if (!encrypted) return false;

  try {
    mkdirSync(CREDENTIAL_DIR, { recursive: true });
    writeFileSync(CREDENTIAL_FILE, encrypted, "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove stored Figma token.
 */
export function removeFigmaToken(): boolean {
  if (existsSync(CREDENTIAL_FILE)) {
    try {
      unlinkSync(CREDENTIAL_FILE);
      return true;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Validate a Figma token by making a real API request.
 */
export async function validateFigmaToken(token: string): Promise<{ valid: boolean; error?: string; userName?: string }> {
  try {
    const response = await fetch("https://api.figma.com/v1/me", {
      headers: { "X-Figma-Token": token },
    });

    if (response.ok) {
      const data = await response.json() as { handle?: string; email?: string };
      return { valid: true, userName: data.handle || data.email };
    }

    if (response.status === 403) {
      return { valid: false, error: "Invalid or expired token" };
    }
    if (response.status === 429) {
      return { valid: false, error: "Rate limited. Please try again later." };
    }
    return { valid: false, error: `API error: ${response.status} ${response.statusText}` };
  } catch (error: any) {
    return { valid: false, error: `Network error: ${error.message}` };
  }
}
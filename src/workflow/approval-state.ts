import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findProjectRoot } from "../memory/memory.js";

export const STATE_DIR = ".node-cli/state";
export const APPROVAL_STATE_PATH = join(STATE_DIR, "approval.json");

export type ApprovalStatus = "none" | "pending" | "approved" | "invalidated";

export interface ApprovalStateRecord {
    status: ApprovalStatus;
    planRevision: number;
    approvedAt: string | null;
    planHash: string | null;
    artifactsHash: string | null;
}

export function getStateDir(projectRoot?: string): string {
    const root = projectRoot ?? findProjectRoot();
    return join(root, STATE_DIR);
}

export function getApprovalStatePath(projectRoot?: string): string {
    return join(getStateDir(projectRoot), "approval.json");
}

export function ensureStateDir(projectRoot?: string): string {
    const dir = getStateDir(projectRoot);
    mkdirSync(dir, { recursive: true });
    return dir;
}

export function readApprovalState(projectRoot?: string): ApprovalStateRecord | null {
    const path = getApprovalStatePath(projectRoot);
    if (!existsSync(path)) return null;
    try {
        return JSON.parse(readFileSync(path, "utf8")) as ApprovalStateRecord;
    } catch {
        return null;
    }
}

export function writeApprovalState(
    record: ApprovalStateRecord,
    projectRoot?: string
): void {
    ensureStateDir(projectRoot);
    writeFileSync(getApprovalStatePath(projectRoot), JSON.stringify(record, null, 2), "utf8");
}

export function createDefaultApprovalState(projectRoot?: string): ApprovalStateRecord {
    return {
        status: "none",
        planRevision: 0,
        approvedAt: null,
        planHash: null,
        artifactsHash: null,
    };
}

export function grantApproval(
    planRevision: number,
    planHash: string | null,
    artifactsHash: string | null,
    projectRoot?: string
): ApprovalStateRecord {
    const record: ApprovalStateRecord = {
        status: "approved",
        planRevision,
        approvedAt: new Date().toISOString(),
        planHash,
        artifactsHash,
    };
    writeApprovalState(record, projectRoot);
    return record;
}

export function invalidateApproval(projectRoot?: string): void {
    const record = readApprovalState(projectRoot) ?? createDefaultApprovalState(projectRoot);
    record.status = "invalidated";
    record.approvedAt = null;
    record.planRevision += 1;
    writeApprovalState(record, projectRoot);
}

export function requestApproval(projectRoot?: string): void {
    const record = readApprovalState(projectRoot) ?? createDefaultApprovalState(projectRoot);
    record.status = "pending";
    writeApprovalState(record, projectRoot);
}
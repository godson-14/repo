import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const PROTECTED_NAMES = new Set(["main", "master", "production", "prod", "staging", "develop", "development"]);

export function isProtectedBranch(branch) {
  if (typeof branch !== "string" || !branch.trim()) return true;
  const normalized = branch.trim().toLowerCase();
  return PROTECTED_NAMES.has(normalized) || normalized.startsWith("release/") ||
    normalized.startsWith("production/") || normalized.startsWith("prod/") || normalized.startsWith("staging/");
}

export function getBranchFromEvent(eventName, event) {
  if (eventName === "pull_request") return event?.action === "closed" ? event?.pull_request?.head?.ref ?? null : null;
  if (eventName === "delete") return event?.ref_type === "branch" ? event?.ref ?? null : null;
  return null;
}

function requireExactBranch(branch) {
  if (typeof branch !== "string" || !branch.trim()) throw new Error("No branch name was found in the GitHub event; nothing will be cleaned.");
  if (isProtectedBranch(branch)) throw new Error(`Refusing to clean protected branch "${branch}".`);
  return branch;
}

function queryUrl(base, params) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function responseJson(response, label) {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${label} failed with HTTP ${response.status}${body ? `: ${body.slice(0, 500)}` : ""}`);
  }
  return response.json();
}

export async function cleanupSupabaseBranches({ branchName, token, projectRef, dryRun = true, fetchImpl = fetch, log = console.log }) {
  if (!token) return { skipped: true, reason: "SUPABASE_ACCESS_TOKEN is not configured." };
  if (!projectRef) throw new Error("SUPABASE_PROJECT_REF is required when a Supabase token is configured.");
  const listUrl = `https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/branches`;
  const branches = await responseJson(await fetchImpl(listUrl, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" }
  }), "Supabase branch listing");
  if (!Array.isArray(branches)) throw new Error("Supabase returned an unexpected branch list.");
  const matches = branches.filter((item) => {
    const exactName = item?.git_branch === branchName || item?.name === branchName;
    return exactName && item?.is_default !== true && item?.persistent !== true;
  });
  for (const item of matches) {
    const id = item.id ?? item.name;
    if (!id) continue;
    if (dryRun) {
      log(`[dry-run] Would delete Supabase branch "${item.name ?? id}" for Git branch "${branchName}".`);
      continue;
    }
    const deleteUrl = `https://api.supabase.com/v1/branches/${encodeURIComponent(id)}`;
    await responseJson(await fetchImpl(deleteUrl, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}`, accept: "application/json" }
    }), `Supabase branch deletion for ${item.name ?? id}`);
    log(`Deleted Supabase branch "${item.name ?? id}".`);
  }
  if (matches.length === 0) log(`No matching non-persistent Supabase branch found for "${branchName}".`);
  return { matched: matches.length, deleted: dryRun ? 0 : matches.length };
}

export async function cleanupVercelDeployments({ branchName, token, projectId, teamId, dryRun = true, fetchImpl = fetch, log = console.log }) {
  if (!token) return { skipped: true, reason: "VERCEL_TOKEN is not configured." };
  if (!projectId) throw new Error("VERCEL_PROJECT_ID is required when a Vercel token is configured.");
  const listUrl = queryUrl("https://api.vercel.com/v6/deployments", {
    projectId, gitBranch: branchName, target: "preview", limit: 100, teamId
  });
  const payload = await responseJson(await fetchImpl(listUrl, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" }
  }), "Vercel deployment listing");
  const deployments = Array.isArray(payload) ? payload : payload?.deployments;
  if (!Array.isArray(deployments)) throw new Error("Vercel returned an unexpected deployment list.");
  const matches = deployments.filter((deployment) => {
    const exactRef = deployment?.meta?.githubCommitRef ?? deployment?.gitSource?.ref;
    return Boolean(deployment?.uid ?? deployment?.id) && exactRef === branchName &&
      deployment?.target === "preview" && deployment?.projectId === projectId;
  });
  for (const deployment of matches) {
    const id = deployment.uid ?? deployment.id;
    if (dryRun) {
      log(`[dry-run] Would delete Vercel preview deployment "${id}" for branch "${branchName}".`);
      continue;
    }
    const deleteUrl = queryUrl(`https://api.vercel.com/v13/deployments/${encodeURIComponent(id)}`, { teamId });
    await responseJson(await fetchImpl(deleteUrl, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}`, accept: "application/json" }
    }), `Vercel deployment deletion for ${id}`);
    log(`Deleted Vercel preview deployment "${id}".`);
  }
  if (matches.length === 0) log(`No exact-match Vercel preview deployments found for "${branchName}".`);
  return { matched: matches.length, deleted: dryRun ? 0 : matches.length };
}

export async function runGarbageCollector({ eventName, event, env = process.env, fetchImpl = fetch, log = console.log }) {
  const candidate = getBranchFromEvent(eventName, event);
  if (!candidate) {
    log(`Ignoring event "${eventName}" because it is not a closed pull request or deleted branch.`);
    return { skipped: true, reason: "Unsupported event." };
  }
  const branchName = requireExactBranch(candidate);
  const dryRun = String(env.INPUT_DRY_RUN ?? "true").toLowerCase() !== "false";
  log(`GarbageCollector-Dev: branch="${branchName}", mode=${dryRun ? "DRY RUN" : "DELETE"}.`);
  const common = { branchName, dryRun, fetchImpl, log };
  const [supabase, vercel] = await Promise.all([
    cleanupSupabaseBranches({ ...common, token: env.SUPABASE_ACCESS_TOKEN, projectRef: env.SUPABASE_PROJECT_REF }),
    cleanupVercelDeployments({ ...common, token: env.VERCEL_TOKEN, projectId: env.VERCEL_PROJECT_ID, teamId: env.VERCEL_TEAM_ID })
  ]);
  return { branchName, dryRun, supabase, vercel };
}

async function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error("GITHUB_EVENT_PATH is missing; this script should run inside GitHub Actions.");
  const event = JSON.parse(await readFile(eventPath, "utf8"));
  const actionEnv = {
    ...process.env,
    INPUT_DRY_RUN: process.env["INPUT_DRY-RUN"] ?? process.env.INPUT_DRY_RUN,
    VERCEL_TOKEN: process.env["INPUT_VERCEL-TOKEN"] ?? process.env.VERCEL_TOKEN,
    VERCEL_TEAM_ID: process.env["INPUT_VERCEL-TEAM-ID"] ?? process.env.VERCEL_TEAM_ID,
    VERCEL_PROJECT_ID: process.env["INPUT_VERCEL-PROJECT-ID"] ?? process.env.VERCEL_PROJECT_ID,
    SUPABASE_ACCESS_TOKEN: process.env["INPUT_SUPABASE-ACCESS-TOKEN"] ?? process.env.SUPABASE_ACCESS_TOKEN,
    SUPABASE_PROJECT_REF: process.env["INPUT_SUPABASE-PROJECT-REF"] ?? process.env.SUPABASE_PROJECT_REF
  };
  const result = await runGarbageCollector({ eventName: process.env.GITHUB_EVENT_NAME, event, env: actionEnv });
  if (process.env.GITHUB_OUTPUT) {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(process.env.GITHUB_OUTPUT, `dry_run=${String(result.dryRun ?? true)}\n`);
    await appendFile(process.env.GITHUB_OUTPUT, `branch_name=${String(result.branchName ?? "")}\n`);
  }
}

if (process.env.GITHUB_ACTIONS === "true" && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`GarbageCollector-Dev failed safely: ${error.message}`);
    process.exitCode = 1;
  });
}

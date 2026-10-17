import test from "node:test";
import assert from "node:assert/strict";
import {
  getBranchFromEvent,
  isProtectedBranch,
  cleanupSupabaseBranches,
  cleanupVercelDeployments,
  runGarbageCollector
} from "../src/index.mjs";

test("extracts a branch only from a closed pull request", () => {
  assert.equal(getBranchFromEvent("pull_request", { action: "closed", pull_request: { head: { ref: "feature/search" } } }), "feature/search");
  assert.equal(getBranchFromEvent("pull_request", { action: "opened", pull_request: { head: { ref: "feature/search" } } }), null);
});

test("extracts only deleted branch refs, not tags", () => {
  assert.equal(getBranchFromEvent("delete", { ref_type: "branch", ref: "bugfix/123" }), "bugfix/123");
  assert.equal(getBranchFromEvent("delete", { ref_type: "tag", ref: "v1.0.0" }), null);
});

test("protects production and persistent branch names", () => {
  for (const name of ["main", "master", "production", "prod", "staging", "release/v1", "production/hotfix"]) {
    assert.equal(isProtectedBranch(name), true, name);
  }
  assert.equal(isProtectedBranch("feature/new-card"), false);
});

test("Supabase dry-run matches exact non-persistent branches only", async () => {
  const calls = [];
  const logs = [];
  const result = await cleanupSupabaseBranches({
    branchName: "feature/card", token: "test-token", projectRef: "project123", dryRun: true,
    log: (line) => logs.push(line),
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method ?? "GET" });
      return new Response(JSON.stringify([
        { id: "one", name: "feature-card", git_branch: "feature/card", persistent: false, is_default: false },
        { id: "two", name: "feature/card", git_branch: "feature/card", persistent: true, is_default: false },
        { id: "three", name: "feature/card-extra", git_branch: "feature/card-extra", persistent: false, is_default: false }
      ]), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(result.matched, 1);
  assert.equal(result.deleted, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
  assert.match(logs[0], /dry-run/);
});

test("Vercel cleanup only matches exact project, branch and preview deployment", async () => {
  const calls = [];
  const result = await cleanupVercelDeployments({
    branchName: "feature/card", token: "test-token", projectId: "project-123", dryRun: true, log: () => {},
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method ?? "GET" });
      return new Response(JSON.stringify({ deployments: [
        { uid: "match", projectId: "project-123", target: "preview", meta: { githubCommitRef: "feature/card" } },
        { uid: "wrong-branch", projectId: "project-123", target: "preview", meta: { githubCommitRef: "feature/card-extra" } },
        { uid: "production", projectId: "project-123", target: "production", meta: { githubCommitRef: "feature/card" } },
        { uid: "wrong-project", projectId: "other-project", target: "preview", meta: { githubCommitRef: "feature/card" } }
      ] }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(result.matched, 1);
  assert.equal(result.deleted, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
});

test("dry-run is the default and no configured provider tokens means no deletes", async () => {
  const result = await runGarbageCollector({
    eventName: "delete", event: { ref_type: "branch", ref: "feature/no-secrets" }, env: {},
    fetchImpl: async () => { throw new Error("Network must not be called without credentials"); }, log: () => {}
  });
  assert.equal(result.dryRun, true);
  assert.equal(result.supabase.skipped, true);
  assert.equal(result.vercel.skipped, true);
});

test("refuses to run cleanup for production branch names", async () => {
  await assert.rejects(() => runGarbageCollector({
    eventName: "delete", event: { ref_type: "branch", ref: "main" }, env: {}, log: () => {}
  }), /protected branch/);
});

test("provider API errors are reported instead of ignored", async () => {
  await assert.rejects(() => cleanupSupabaseBranches({
    branchName: "feature/card", token: "token", projectRef: "project",
    fetchImpl: async () => new Response("bad token", { status: 403 }), log: () => {}
  }), /HTTP 403/);
});

test("Supabase delete mode sends DELETE only for an exact disposable branch", async () => {
  const calls = [];
  const result = await cleanupSupabaseBranches({
    branchName: "feature/cleanup",
    token: "test-token",
    projectRef: "project123",
    dryRun: false,
    log: () => {},
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method ?? "GET" });
      if (!options.method) {
        return new Response(JSON.stringify([
          { id: "branch-id-1", name: "preview-branch", git_branch: "feature/cleanup", persistent: false, is_default: false },
          { id: "branch-id-2", name: "main", git_branch: "main", persistent: false, is_default: true }
        ]), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ message: "ok" }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(result.deleted, 1);
  assert.deepEqual(calls.map((call) => call.method), ["GET", "DELETE"]);
  assert.match(calls[1].url, /branch-id-1/);
});

test("Vercel delete mode removes only the exact preview deployment", async () => {
  const calls = [];
  const result = await cleanupVercelDeployments({
    branchName: "feature/cleanup",
    token: "test-token",
    projectId: "project-123",
    dryRun: false,
    log: () => {},
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method ?? "GET" });
      if (!options.method) {
        return new Response(JSON.stringify({ deployments: [
          { uid: "preview-id", projectId: "project-123", target: "preview", meta: { githubCommitRef: "feature/cleanup" } },
          { uid: "prod-id", projectId: "project-123", target: "production", meta: { githubCommitRef: "feature/cleanup" } }
        ] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ id: "preview-id" }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(result.deleted, 1);
  assert.deepEqual(calls.map((call) => call.method), ["GET", "DELETE"]);
  assert.match(calls[1].url, /preview-id/);
});

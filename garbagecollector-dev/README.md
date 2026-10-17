# GarbageCollector-Dev

A GitHub Action that identifies orphaned preview deployments and temporary Supabase database branches after a pull request closes or a Git branch is deleted.

## Safety defaults

- Dry-run is enabled by default. It reports matching resources without deleting them.
- Only resources with an exact branch-name match are considered.
- Vercel cleanup is restricted to the configured project and preview deployments.
- Supabase default and persistent branches are never deleted.
- Protected branch names such as main, production, staging, and release/* are rejected.
- API errors are surfaced in the action log instead of being silently ignored.

## Configure in your repository

1. Copy this action folder into your repository, or reference this repository and folder from another workflow.
2. In repository settings, add only the provider secrets you need: VERCEL_TOKEN and SUPABASE_ACCESS_TOKEN.
3. Add non-secret repository variables: VERCEL_PROJECT_ID, optional VERCEL_TEAM_ID, and SUPABASE_PROJECT_REF.
4. Start with dry-run set to true. Review the action logs to confirm the exact resources it would target.
5. Only after reviewing the dry-run output, explicitly set dry-run to false for a test repository with disposable preview resources.

Never put tokens directly in workflow YAML or commit them to the repository. Use GitHub Actions secrets and narrowly scoped provider tokens where possible.

## Example workflow

Save this as .github/workflows/garbage-collector.yml in the repository where you want cleanup events monitored:

    name: GarbageCollector-Dev
    on:
      pull_request:
        types: [closed]
      delete:
        branches:
          - '**'
    permissions:
      contents: read
    jobs:
      cleanup:
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v4
          - name: Inspect and clean staging resources
            uses: YOUR_GITHUB_USERNAME/YOUR_REPOSITORY/garbagecollector-dev@main
            with:
              dry-run: "true"
              vercel-token: ${{ secrets.VERCEL_TOKEN }}
              vercel-project-id: ${{ vars.VERCEL_PROJECT_ID }}
              vercel-team-id: ${{ vars.VERCEL_TEAM_ID }}
              supabase-access-token: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
              supabase-project-ref: ${{ vars.SUPABASE_PROJECT_REF }}

Replace the placeholder action reference with the repository and ref where this folder lives. GitHub Actions passes the pull_request or delete event into the action automatically.

## Local tests

Requires Node.js 20 or newer. From this directory, run npm test.

## Current scope and limitations

This first version supports Vercel preview deployments and Supabase database branches. It does not inspect AWS resources. It deliberately does not delete anything by substring matching. Provider APIs and permissions can change, so verify dry-run logs and test against disposable staging resources before enabling deletion.

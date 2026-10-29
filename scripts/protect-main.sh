#!/usr/bin/env bash
# Lock down `main` (mirrors KnowYourCity):
#   - all changes via PR (0 required approvals, so a solo dev can self-merge)
#   - required status checks must pass and the branch must be up to date
#   - every PR conversation must be resolved before merge
#   - rules also apply to admins
#   - no force-pushes, no branch deletion
#   - branches auto-delete on merge; squash merge enabled
#
# REQUIREMENT: branch protection is only available on PUBLIC repos on the Free
# plan (or any repo on a paid plan). This repo is public.
#
# Usage:  bash scripts/protect-main.sh            # default repo
#         bash scripts/protect-main.sh owner/repo  # another repo
set -euo pipefail

REPO="${1:-wardcrazy01894/CampusPinShowdown}"

echo "Applying branch protection to $REPO@main ..."
gh api -X PUT "repos/$REPO/branches/main/protection" --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["build / typecheck / lint", "test", "secret scan"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": false,
  "required_conversation_resolution": true
}
JSON

echo "Enabling delete-branch-on-merge + squash merge ..."
gh api -X PATCH "repos/$REPO" -f delete_branch_on_merge=true -f allow_squash_merge=true >/dev/null

echo "Done. main is now PR-only with required checks: build / typecheck / lint, test, secret scan."

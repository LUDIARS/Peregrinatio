# PR test forum intake was missed

- Date: 2026-07-19
- Status: investigating
- Area: Concordia PR test workflow / Discord Test forum
- Severity: feature PR could not enter human confirmation

## Summary

PR #47 for the map and itinerary facility UI passed GitHub Actions, but no Test forum post was created. The user reported that the change was not posted in the test area.

## Evidence

- PR: `https://github.com/LUDIARS/Peregrinatio/pull/47`
- Feature commit: `c76b94000d260b1319e2d4b101a4da2d49b8afbe`
- GitHub Actions `build-test`: passed in 37 seconds.
- `GET /v1/prs/list?repo=Peregrinatio&limit=20` returned no PR records after PR creation.
- `GET /v1/confirm` did not contain Peregrinatio #47.
- The active Test forum flow stores `discord_thread_id`, `test_summary`, and `test_items_json` on confirmation rows and tests an open PR branch before merge.

## Regression Context

This was an operational workflow miss rather than a product-code regression. The PR was created directly through GitHub CLI without first being associated with Concordia's TaskWorkflow/PR intake, so CI success alone did not create a Test forum post.

## Cause

The initial response interpreted “test workflow” as GitHub Actions only. A second attempt followed an older develop-merge confirm specification, but the running Concordia flow expects an open main-targeting PR to be registered before human testing. Because #47 was absent from `pr_records`, the Test forum intake did not run.

## Fix Requirements

- Restore the feature as an open PR targeting `main`.
- Keep the PR unmerged until Concordia records it and creates a Test forum thread.
- Verify the confirmation row has a non-null `discord_thread_id` before reporting completion.
- Do not treat GitHub Actions success as completion of the human-test workflow.

## Verification

- The replacement PR appears in `/v1/prs/list?repo=Peregrinatio`.
- `/v1/confirm` contains the replacement PR in `pending` state.
- The row has a non-null `discord_thread_id` and the Test forum shows the post.
- GitHub Actions remains green.

## Follow-up

- Decide whether to remove the temporary `develop` branch and `E:/Document/Ars/develop/Peregrinatio` clone created while following the outdated flow.
- Update operational guidance so “test workflow” explicitly means Concordia Test forum intake, not only GitHub Actions.

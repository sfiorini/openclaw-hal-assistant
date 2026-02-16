# Release and Rollback

## Local release prep

1. Ensure your working tree is clean.
2. Run one of:
   - `pnpm release:patch`
   - `pnpm release:minor`
   - `pnpm release:major`
   - `pnpm release:version <x.y.z>`
3. Push changes and tags:
   - `git push`
   - `git push --tags`
   - or run release command with `--push`

## GitHub release publish

1. Create a GitHub release using the exact semantic tag produced locally (for example `v1.2.3`).
2. `docker-release.yml` will:
   - verify `tests/unit` and `tests/integration`
   - run `pnpm exec tsc --noEmit`
   - run `pnpm lint`
   - run `pnpm build`
   - build and push Docker image tags:
     - `${DOCKERHUB_USERNAME}/openclaw-hal-assistant:v1.2.3`
     - `${DOCKERHUB_USERNAME}/openclaw-hal-assistant:latest`

Required GitHub secrets:

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`
- optional manual trigger input: `release_tag`

## Rollback

A rollback is done by restoring a previously known-good image tag:

1. Identify the last stable release version (for example `v1.2.2`).
2. Re-run release steps to republish or create a new release for the target version.
3. Re-deploy from the stable tag in your environment.

Important: if image tags are immutable in your registry policy, treat `latest` as mutable and always deploy pinned version tags where possible.

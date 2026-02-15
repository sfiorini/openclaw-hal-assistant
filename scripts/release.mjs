import { execSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const USAGE = `Usage:
  node scripts/release.mjs <patch|minor|major|version> [<version>]

Commands:
  patch         Bump PATCH version (x.y.Z -> x.y.Z+1)
  minor         Bump MINOR version (x.Y.z -> x.Y+1.0)
  major         Bump MAJOR version (X.y.z -> X+1.0.0)
  version       Use explicit version (semver) passed as the next argument

Options:
  --push        Push commit and tag after creating them.
  --dry-run     Show planned operations without changing files.
`

const parseSemver = (value) => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value)
  if (!match) {
    return null
  }
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  }
}

const run = (command, options = {}) => {
  return execSync(command, {
    stdio: "inherit",
    encoding: "utf8",
    shell: true,
    ...options,
  })
}

const main = () => {
  const args = process.argv.slice(2)
  const mode = args[0]
  const pushRequested = args.includes("--push")
  const dryRun = args.includes("--dry-run")

  if (!mode || mode.startsWith("-")) {
    console.error(USAGE)
    process.exit(1)
  }

  if (mode === "--help" || mode === "-h") {
    console.log(USAGE)
    process.exit(0)
  }

  const path = resolve(process.cwd(), "package.json")
  const packageContent = JSON.parse(readFileSync(path, "utf8"))
  const version = packageContent.version

  const current = parseSemver(version)
  if (!current) {
    throw new Error(`Invalid package.json version: ${version}`)
  }

  const explicitVersionArg = mode === "version" ? args.find((arg) => {
    if (arg === "version" || arg.startsWith("-")) {
      return false
    }
    return true
  }) : null
  if (mode === "version" && !explicitVersionArg) {
    console.error("release:version requires an explicit version (x.y.z)")
    console.error(USAGE)
    process.exit(1)
  }

  if (!["patch", "minor", "major", "version"].includes(mode)) {
    console.error(`Unsupported release mode: ${mode}`)
    console.error(USAGE)
    process.exit(1)
  }

  let next = current
  if (mode === "patch") {
    next = { ...current, patch: current.patch + 1 }
  } else if (mode === "minor") {
    next = { major: current.major, minor: current.minor + 1, patch: 0 }
  } else if (mode === "major") {
    next = { major: current.major + 1, minor: 0, patch: 0 }
  } else {
    const explicit = parseSemver(explicitVersionArg)
    if (!explicit) {
      console.error(`Invalid explicit version: ${explicitVersionArg}`)
      process.exit(1)
    }
    next = explicit
  }

  const nextVersion = `${next.major}.${next.minor}.${next.patch}`

  if (nextVersion === version) {
    console.error(`Computed version is unchanged: ${version}`)
    process.exit(1)
  }

  const tag = `v${nextVersion}`
  const releaseCommitMessage = `chore(release): ${tag}`

  const existingTag = run(`git tag --list ${tag}`, { stdio: "pipe" }).toString().trim()
  if (existingTag.length > 0) {
    throw new Error(`Tag already exists: ${tag}`)
  }

  if (dryRun) {
    console.log(`Current version: ${version}`)
    console.log(`Next version: ${nextVersion}`)
    console.log(`Release tag: ${tag}`)
    console.log(`Push: ${pushRequested ? "enabled" : "disabled"}`)
    return
  }

  const gitStatus = run("git status --short", { encoding: "utf8", stdio: "pipe" }).toString()
  if (gitStatus.trim().length > 0) {
    throw new Error("Working tree is dirty. Commit or stash changes before releasing.")
  }

  packageContent.version = nextVersion
  writeFileSync(path, JSON.stringify(packageContent, null, 2) + "\n")

  run(`git add package.json`)
  run(`git commit --message "${releaseCommitMessage}"`)
  run(`git tag ${tag}`)

  if (pushRequested) {
    run("git push")
    run(`git push --tags`)
  }

  console.log(`Release prepared: ${tag}`)
}

main()

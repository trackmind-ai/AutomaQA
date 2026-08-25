# Contributing to AutomaQA

Thanks for your interest. Issues and pull requests are both welcome.

## Ground rules

AutomaQA is a Claude Code plugin, so most of it is **prompt content**, not code. The skills
in `plugins/automaqa/skills/` are instructions an agent follows. Treat them like code:
they are precise, ordered, and testable.

Two principles shape everything here:

1. **Verify before asserting.** Never write a selector, path, or version that has not been
   confirmed against the live system. Every dependency check in `setup` runs a version
   command first.
2. **Never ship samples.** The plugin creates files in the *user's* project. It must not
   carry example specs, example tests, or captured screenshots.

## Repository layout

See [Repository layout](README.md#repository-layout).

## Making a change

```bash
git clone https://github.com/trackmind-ai/automaqa
cd automaqa
npm install
```

Point Claude Code at your working copy to try it:

```bash
/plugin marketplace add ./path/to/automaqa
/plugin install automaqa@trackmind-automaqa
```

Then validate before opening a PR:

```bash
bash scripts/validate.sh
```

That checks manifests parse as JSON, every skill has the required frontmatter, the
TypeScript templates typecheck, the unit and behaviour tests pass, the code examples in
`SAMPLE.md` still compile, every path in [`.github/CODEOWNERS`](.github/CODEOWNERS)
actually exists, and no stale plugin paths remain.

If you change a shipped template, run `npm run test:docs` too — `SAMPLE.md` shows real
code against those templates, and a walkthrough with broken code is worse than none.

A PR touching the plugin manifest, `plugins/automaqa/hooks/`, `scripts/`, or `.github/`
needs a maintainer review per `.github/CODEOWNERS` — those paths decide what code the
plugin installs or runs, so they don't merge on a contributor's own approval alone.

## Editing skills

Each skill is a single `SKILL.md` with YAML frontmatter:

```yaml
---
description: One sentence on what the skill does.
when_to_use: Concrete trigger phrases the model should match on.
argument-hint: [optional | args]
---
```

Keep `when_to_use` specific — it is how the model decides to invoke the skill. Vague
descriptions cause both missed and spurious invocations.

If you add a step to a workflow skill, renumber the steps and update the skill's step-skip
reference table if it has one.

## Commit messages

Use a short imperative subject: `setup: verify Java before installing Maestro`.

## Reporting a bug

Include your OS, Claude Code version, the skill you invoked, and the full status table if
setup produced one. For a security issue, follow [SECURITY.md](SECURITY.md) instead of
opening a public issue.

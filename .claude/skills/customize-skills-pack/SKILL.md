---
name: customize-skills-pack
description: Add, remove, rename, or reorder bundled preset skills while preserving the registry, content-folder, frontmatter, and Anthropic upload invariants.
---

# Customize the preset skills pack

Read `src/features/skills/constants.ts`, `scripts/config-validation.ts`, and `tests/skills/preset-content-dirs.test.mjs` first. Preset files live in Git under `content/`; `PRESET_SKILLS` is the ordered pack provisioned to workspaces.

## Add a preset

1. Choose a clear display name and description.
2. Derive the upload directory exactly as `slugifyConfigName` does: lowercase the name, remove characters other than ASCII letters, digits, spaces, and hyphens, trim it, then replace spaces with hyphens.
3. Create one dedicated `content/<directory>/` folder. Its root `SKILL.md` must open with YAML frontmatter whose `name` exactly equals the registry display name and whose description explains when the skill applies. Put only that skill's files in the folder.
4. Add named constants and one `PresetSkill` entry in `src/features/skills/constants.ts`. Set `directory` to the derived upload slug and `contentDir` to the real folder path.
5. Place the entry where it should appear in the ordered default pack.

Every file under `contentDir` is read recursively and included in the preset content hash. New workspaces get the changed version when they are set up; a workspace that is already set up gets it only through `pnpm skills:backfill`.

## Remove, rename, or reorder

To remove a preset from future workspace reconciliation, remove its `PRESET_SKILLS` entry and now-unused constants. Delete its content folder only when the operator confirms the bundled source should also be removed. Do not touch user-created skills or database rows as part of a pack edit.

To rename a preset, update the registry name, directory slug, content folder, `contentDir`, and `SKILL.md` frontmatter name together. Anthropic does not allow a new version to change the original skill name, so a rename creates a new upstream skill identity. Reordering only changes the registry array order.

Classic failures are a missing content folder, no root `SKILL.md`, frontmatter that names a different skill, an upload directory that is not the exact name slug, or a `contentDir` still pointing to the old folder. Do not create a second preset registry.

## Verify

Run:

```bash
pnpm validate:config
node --import ./scripts/register-aliases.mjs --test tests/skills/preset-content-dirs.test.mjs tests/configuration/config-validation.test.mjs
pnpm verify
```

Review the validator's operator-readable errors directly. It also checks brand identity, connected apps, agent tiers, and required environment values, so an unrelated failure still needs to be reported accurately.

`pnpm skills:backfill` pushes the pack to Anthropic for a deployment whose workspaces are already provisioned; new workspaces pick it up on their own. It requires credentials and changes external state, so run it only when the operator explicitly asks. Report additions and renames as new upstream identities, and report removals without claiming that historical provider objects or database rows were deleted.

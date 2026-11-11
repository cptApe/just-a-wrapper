---
name: Create a Skill
description: Build a new skill with the user by interviewing them about the way of working, then drafting the skill folder and saving it to the workspace.
---

# Create a Skill

Use this skill when a user wants to capture a repeatable way of working, a house style, or a piece of expertise so it carries into every future session. A skill is reusable instructions: write it once, and it loads automatically whenever the work matches. The goal of this conversation is to turn what lives in the user's head into a clean, self-contained skill folder saved to the workspace.

## Interview before you draft

Do not start writing the skill until you understand the work it captures. Ask a few focused questions, one idea at a time, and listen for the details that a future session could not guess.

- **What triggers it.** When should this skill apply? A concrete situation ("drafting a weekly investor update", "reviewing a pull request") is better than a broad topic.
- **The steps.** Walk through how the user does it today, in order. Capture the judgment calls, not just the mechanics.
- **The house style.** Preferences that must hold every time: tone, formatting, length, things to always do, things to never do.
- **The inputs.** What the skill needs to have on hand, and where that comes from (a connected integration, a file, workspace memory).

If the user is vague, offer a first draft from what you have and let them correct it. A concrete draft they can react to beats more questions.

## Draft the skill folder

A skill is a folder with a `SKILL.md` at its root. Keep it self-contained and small.

1. **Frontmatter.** Open with a `name` and a one-line `description`. The description is how the skill gets matched, so make it say plainly when to use it and what it does.
2. **Body.** Write instructions to the agent, not documentation about the agent. Lead with when to use it, then the steps and the style rules. Use plain sentences and short sections.
3. **Supporting files.** Only add extra files when they earn their place: a template, a reference the instructions point to, an example. Do not pad the folder.

Mirror the user's own words where you can. The skill should read like their standard, written down.

## Save it and confirm

Once the draft holds together, save the skill folder to the workspace so it is available in future sessions. Tell the user what you named it and what will trigger it, and offer one small refinement they might want before moving on.

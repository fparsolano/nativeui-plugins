---
name: nativeui-editor
description: >-
  Safely hand a NativeUI project to the cloud editor, resume editor work, publish guarded changes,
  or round-trip one screen without replacing the whole project. Use when the user wants to edit or
  fine-tune in the NativeUI editor, resume cloud work, pull editor changes, or update one existing screen.
metadata:
  argument_hint: "handoff|resume|publish <project.json> or screen extract/update"
allowed-tools: "Bash(node ${CLAUDE_SKILL_DIR}/../../bin/*) Bash(node */nativeui-plugin/bin/*) Read Write Edit Glob"
---

# NativeUI editor handoff and screen round-trip

Use `<bin>` as `${CLAUDE_SKILL_DIR}/../../bin`.

For editor synchronization, run the guarded workflow rather than copying JSON manually:

```bash
node <bin>/nui-editor.mjs handoff project.json --name "My App" --open
node <bin>/nui-editor.mjs resume project.json --name "My App"
node <bin>/nui-editor.mjs publish project.json --name "My App"
```

`handoff` and `publish` validate before pushing. `resume` pulls only when the cloud revision changed
and the local copy did not. A local/cloud conflict exits with status 2 and must be resolved explicitly;
never overwrite either side automatically. Publishing is guarded by the expected remote revision.

For a focused design tweak, round-trip only one screen:

```bash
node <bin>/nui-screen-extract.mjs project.json --stage <id-or-name> -o screen.html
# edit screen.html
node <bin>/nui-screen-update.mjs project.json --stage <id-or-name> --html screen.html
```

The update preserves the stage ID, existing name unless `--rename` is given, board placement,
non-target screens, project metadata, and unrelated resources. Library collisions receive stable new
IDs and references are remapped. The merged project is validated in temporary storage and atomically
replaces the original only after validation succeeds.

After an editor round-trip, run `nui-final-review` and export the selected target IDs. Never embed
credentials in project JSON or logs.

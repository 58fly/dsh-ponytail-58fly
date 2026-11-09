<h1 align="center">🦥 dsh-ponytail</h1>

<div align="center">

**🌐 [English](docs/README.en.md) · [中文](README.md)**

Write less code. Reuse what already exists.

*The smallest change that fully solves the task.*

[![version](https://img.shields.io/npm/v/dsh-ponytail-58fly)](https://www.npmjs.com/package/dsh-ponytail-58fly)
[![host](https://img.shields.io/badge/host-DSH%200.2.x-4B8BBE)](https://github.com/deepseek-ai)
[![skills](https://img.shields.io/badge/skills-6-orange)]()
[![runtime dependencies](https://img.shields.io/badge/runtime%20deps-0-brightgreen)]()
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)

</div>

<h2 align="center"><sub>INSTALL</sub><br>Two steps</h2>

```bash
# ① install into your profile (--profile is required; templates: web / headless / acp / sdk)
dsh plugin --profile web add dsh-ponytail-58fly

# ② restart DSH
```

Run `/ponytail` in a session to read the current level. Settings → "Ponytail 档位" switches it.

Offline or behind a firewall, install from a tarball:

```bash
pnpm run build && npm pack
dsh plugin --profile web add ./dsh-ponytail-58fly-0.3.0.tgz
```

Desktop app (Electron-owned profiles; `dsh plugin` refuses to write them):

```bash
cd ~/.dsh/profiles/desktop && pnpm add /path/to/dsh-ponytail-58fly-0.3.0.tgz
```

<h2 align="center"><sub>CORE</sub><br>What it does</h2>

It plants a decision ladder in the system prompt, so the model answers six questions before writing any code:

| # | Ask first | If yes |
| --- | --- | --- |
| 1 | Does this need to exist at all? | Skip it, and say in one line what you saved |
| 2 | Does the repo already have it? | Reuse it the way surrounding code does |
| 3 | Standard library or platform feature? | Use it, unless the project mandates otherwise |
| 4 | Already an installed dependency? | Use it; never add a dependency for a few lines |
| 5 | Can it be one obvious line? | One line |
| 6 | None of the above | The smallest code that actually works |

The level only sets the **intensity**, never the ladder itself:

| Level | Behaviour |
| --- | --- |
| `off` | Fully off; the session returns to normal development mode |
| `lite` | Do as asked, plus one line naming the smaller option so the user can choose |
| `full` | Default. The full ladder |
| `ultra` | Also challenge the request: rebut whatever does not hold up before starting. Best while the requirements are still soft; the price is a slower, chattier session that may overturn a plan you already had |

The ladder lives in a fixed system-prompt section rendered once when the session is born; switching levels appends a `system-reminder` carrying the full instruction set. Switching never invalidates the prompt prefix, so the KV cache survives.

<h2 align="center"><sub>SKILLS</sub><br>Six skills</h2>

| Command | Purpose |
| --- | --- |
| `/ponytail` | Read or switch the level (`lite` / `full` / `ultra` / `off`) |
| `/ponytail-review` | Review one change against the six levels: logic, safety, load, tests, speed, unnecessary code |
| `/ponytail-audit` | Whole-repo audit: bugs, security holes, slow paths, branches to delete or merge |
| `/ponytail-debt` | The debt ledger: every `shortcut:` comment in the repo |
| `/ponytail-gain` | Local efficiency stats: managed turns, injections, per-level split, with upstream benchmark ranges |
| `/ponytail-help` | Quick reference |

The model also invokes them on its own: every description is a Chinese rewrite that keeps the original English trigger words (`be lazy` / `simplest solution` / `yagni` / `debt`), so either language hits.

A slash command needs one half-width space after it:

```text
/ponytail do we need caching here
/ponytail-review look at this diff
```

The host's slash gesture regex only accepts ASCII whitespace boundaries. Writing `/ponytail, xxx` (full-width comma) or `／ponytail` (full-width slash) does not trigger it; the text stays plain prose.

<h2 align="center"><sub>CONFIG</sub><br>Configuration</h2>

| Field | Type | Notes |
| --- | --- | --- |
| `defaultMode` | `enum` | Default level: `off` / `lite` / `full` / `ultra`; falls back to `full` |
| `skillDir` | `string` | Skill directory. Relative paths resolve against `$DSH_HOME`; defaults to `$DSH_HOME/ponytail-58fly/skills` |
| `locale` | `enum` | Language: `zh` / `en`. Declared in Schemastery; nothing consumes it yet |

None of them carries a default value: Cordis validation fills missing fields with explicit config, and once a default exists "configured" and "never configured" become indistinguishable — the settings panel would lie on the user's behalf.

Three ways to change the level, in precedence order `env > profile patch > built-in fallback`:

```bash
# environment variable: the default level for every new session
export PONYTAIL_DEFAULT_MODE=ultra
```

```yaml
# your profile's cordis.patch.yml
- patch:
    - id: ponytail-58fly
      config:
        defaultMode: ultra
```

```text
# switch inside a session (not a shell command — type it in the chat box)
/ponytail ultra
```

Wrong value that seems to do nothing: the settings panel shows, level by level, which layer is shadowing it and what that layer currently holds.

<h2 align="center"><sub>COMPAT</sub><br>Compatibility</h2>

| Item | Requirement |
| --- | --- |
| Node | `>=20` |
| DSH | `>=0.2.0-rc.1 <0.3.0-0`. `engines.dsh` is the only version gate: the host sees it and skips the peer check entirely, so a wrong host version means the plugin does not install rather than running degraded |
| Peers | `@deepseek-ai/cordis ~4.1.0`, `@deepseek-ai/schemastery ~3.19.0`, provided by the host; this package neither installs nor bundles them |
| Deps | **zero**. Not fastidiousness: `dsh plugin add <local dir>` produces a `link:`, pnpm never installs the plugin's `dependencies`, and any runtime `import` fails with `ERR_MODULE_NOT_FOUND`. That is why the six skills come from the package's own `skills/` through the host registry, and this package imports nothing |
| Inject | Two `@deepseek-ai/dsh-client-ui-*` modules; without them the only loss is the settings panel — commands and config keep working |

<h2 align="center"><sub>TROUBLESHOOT</sub><br>Troubleshooting</h2>

| Symptom | Cause | Fix |
| --- | --- | --- |
| No settings panel after install | Host lacks `dsh-client-ui-settings-general` (slot declaration) or `dsh-client-ui-settings` (the `configForms` channel) | Expected degradation, not a fault. Commands, config file and env vars cover everything |
| `dsh.client.inject` with a short name does nothing | The host resolves the module graph by package name; short names are silently skipped | Use the full name `@deepseek-ai/dsh-client-*` |
| Panel says the config namespace is not served | `configForms` is up but no form is served for this namespace — usually the plugin was not loaded through the profile config graph | Edit `cordis.patch.yml` or use the env var |
| Skill list is empty | ① `skillDir` points at an empty directory ② a `SKILL.md` lost its `description` ③ a frontmatter uses a legacy key | ① restore `${package}/skills` ②③ search the log for the frontmatter warning; only that one skill is skipped |
| Slash command does nothing | Missing half-width space, or a full-width `／` | See "Six skills" above |
| `Agent skills awaiting approval` on install | pnpm links dependency `skills/` into the coding agent's skill directory and waits for approval | Approving or not has no effect here: the six skills are read from the package's own `skills/` by DSH's registry |

<h2 align="center"><sub>SOURCE</sub><br>Source and licence</h2>

This plugin is an original, independently developed project: both the code and the six Chinese skill bodies originate in this repository. The rules take their ideas from [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) (MIT); design trade-offs and measured host-contract evidence live in [docs/research/dsh-plugin-contract-0.2.2.md](docs/research/dsh-plugin-contract-0.2.2.md).

MIT, see [LICENSE](LICENSE).

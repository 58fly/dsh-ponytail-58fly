#!/usr/bin/env node
/**
 * 发布门禁与三方对齐校验。
 *
 *   node scripts/verify-release.mjs            # 发布前（prepublishOnly 自动调用）
 *   node scripts/verify-release.mjs --verify   # 发布后自检（pnpm run verify:release）
 *
 * 铁律：npm registry 上每个已发布版本，GitHub 仓库里都必须有对应的 commit 与 tag；
 * GitHub main 的 package.json 版本号必须等于 npm 的 latest。
 * npm 发布不可逆，GitHub 可改可补，所以顺序只能是 Git 先行：commit → tag → push → publish。
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  PROVENANCE_PREDICATE,
  judgeProvenanceCoverage,
  readAttestationPointer,
} from './provenance.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const version = pkg.version
const tagName = `v${version}`

/**
 * 铁律生效前发布、且 GitHub 上确实没有对应 tag 的历史版本。
 * 只允许往这里加「已经无法追溯」的旧版本，新版本一律不得豁免。
 */
const LEGACY_VERSIONS = new Set()

/**
 * npm 自己在发布流程里创建的占位版本，不是我们发的东西。
 * `0.0.0-stage` 是 npm 做 staged publishing 时先占住包名用的，不对应任何 commit，
 * 也无法补 tag——把它当真只会让门禁永远红着。
 */
const NPM_INTERNAL_VERSIONS = new Set(['0.0.0-stage'])

/**
 * 产地签名开关（publish.yml 的 `npm publish --provenance`）上线之前发的版本。
 * 它们没有 SLSA provenance 是历史事实，不是本次发布漏签，不该让门禁永远红。
 * 只往这里加已经发布、且确实没签的旧版本；新版本一个都不许进来。
 */
const NO_PROVENANCE_VERSIONS = new Set(['0.2.0', '0.2.1'])

const failures = []
const notes = []

function fail(message, hint) {
  failures.push(hint ? `${message}\n    → ${hint}` : message)
}

function git(args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
}

function tryGit(args) {
  try {
    return git(args)
  } catch {
    return null
  }
}

// ---- 1. 工作区必须干净 ----
const dirty = tryGit(['status', '--porcelain'])
if (dirty === null) {
  fail('不是 git 仓库，无法校验版本对齐')
} else if (dirty !== '') {
  const lines = dirty.split('\n')
  fail(
    `工作区有 ${lines.length} 处未提交改动，禁止发布`,
    '先 git add -A && git commit，再打 tag、push，最后才发布'
  )
}

// ---- 2. tag 之后，进包的内容不能变过 ----
//
// 真正的约束是「registry 上发布的内容 == tag 指向的内容」，不是「HEAD 正好等于 tag」。
// 用后者会让任何不进包的提交（.github/、docs/、scripts/、.scratch/）把校验打红，
// 逼着为一行 CI 配置发一个内容完全相同的版本号。
const head = tryGit(['rev-parse', 'HEAD'])
const tagCommit = tryGit(['rev-list', '-n', '1', tagName])

if (head === null) {
  fail('读不到 HEAD commit')
} else if (tagCommit === null) {
  fail(
    `本地不存在 tag ${tagName}，GitHub 侧将无法追溯这个版本`,
    `git tag ${tagName} && git push origin main && git push origin ${tagName}`
  )
} else if (tagCommit !== head) {
  const shipped = ['package.json', ...(Array.isArray(pkg.files) ? pkg.files : [])]
  const changed = tryGit(['diff', '--name-only', tagName, head, '--', ...shipped])

  if (changed === null) {
    fail(`无法比较 tag ${tagName} 与 HEAD 的差异`,
      'git 读不到这两个 commit 时无法判断进包内容是否变过')
  } else if (changed !== '') {
    const list = changed.split('\n')
    fail(
      `tag ${tagName} 之后有 ${list.length} 个进包文件变化：${list.slice(0, 5).join('、')}${list.length > 5 ? ' 等' : ''}`,
      '进包内容变了就必须升版本、重新打 tag；只改不进包的文件（docs/、scripts/、.github/、.scratch/）不需要'
    )
  }
}

// ---- 3. CHANGELOG 必须有当前版本的小节 ----
const changelogPath = join(ROOT, 'CHANGELOG.md')
if (!existsSync(changelogPath)) {
  fail('缺少 CHANGELOG.md', '铁律要求每个版本都必须有对应小节')
} else {
  const changelog = readFileSync(changelogPath, 'utf8')
  if (!new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}`, 'm').test(changelog)) {
    fail(
      `CHANGELOG.md 里没有 ${version} 的小节`,
      `补一行 \`## [${version}] - YYYY-MM-DD\`，分类用 新增/修复/变更/文档/移除`
    )
  }
}

// ---- 4. 发布后自检：三方比对 ----
if (process.argv.includes('--verify')) {
  const remote = pkg.repository?.url?.replace(/^git\+/, '').replace(/\.git$/, '')
  notes.push(`本地版本：${version}`)
  notes.push(`tag ${tagName}：${tagCommit ? tagCommit.slice(0, 8) : '缺失'}`)

  try {
    const res = await fetch(`https://registry.npmjs.org/${pkg.name}`, {
      headers: { accept: 'application/vnd.npm.install-v1+json' },
    })
    if (res.status === 404) {
      fail(`registry 上还没有 ${pkg.name}`,
        '首次发布前这条自检不适用；发布后再跑一次')
    } else if (!res.ok) {
      throw new Error(`registry 返回 ${res.status}`)
    } else {
      const meta = await res.json()
      const latest = meta['dist-tags']?.latest
      const published = Object.keys(meta.versions ?? {})

      notes.push(`registry latest：${latest}`)
      notes.push(`registry 已发布：${published.join(', ')}`)

      // 产地签名：当前版本必须带 SLSA provenance，历史版本按豁免表放行。
      // abridged 文档的 versions[v].dist 里就有 attestations 指针（实测 vite 有、本仓
      // 0.2.1 没有），不必为每个版本再打一次单版本接口。
      const entries = Object.entries(meta.versions ?? {}).map(([v, entry]) => ({
        version: v,
        dist: entry?.dist,
      }))
      const coverage = judgeProvenanceCoverage(entries, version)
      if (coverage.current === null) {
        fail(`registry 文档里找不到 ${version} 这个版本，无法判产地签名`,
          '刚发布的版本可能要等几十秒才进 registry 文档，稍后重试')
      } else if (!coverage.current.present) {
        fail(`registry 上的 ${version} 没有产地签名（${coverage.current.why}）`,
          '发布时必须带 npm publish --provenance 且 job 有 id-token: write；补签只能重发一个版本')
      } else if (coverage.current.predicateType !== PROVENANCE_PREDICATE) {
        fail(`${version} 的 attestation 类型是 ${coverage.current.predicateType}，不是 ${PROVENANCE_PREDICATE}`,
          '检查是否换成了别的签名方式；判据只认 SLSA provenance')
      } else {
        notes.push(`产地签名：${version} 带 ${PROVENANCE_PREDICATE}`)
      }

      // 更早的版本按豁免表判：表里没有又确实没签，说明这一次漏了。
      for (const v of coverage.older) {
        if (NPM_INTERNAL_VERSIONS.has(v)) continue
        if (NO_PROVENANCE_VERSIONS.has(v)) {
          notes.push(`  （历史遗留，豁免）${v} 发布时还没有产地签名开关`)
          continue
        }
        fail(`registry 上的 ${v} 没有产地签名，又不在豁免表里`,
          '新版本必须带产地签名；确认漏签就补发一个新版本，或把该旧版本加进 NO_PROVENANCE_VERSIONS')
      }

      if (latest !== version) {
        fail(`registry latest 是 ${latest}，本地是 ${version}`,
          '要么发布新版本，要么回滚本地版本号')
      }

      for (const v of published) {
        if (NPM_INTERNAL_VERSIONS.has(v)) {
          notes.push(`  （registry 内部占位版本，不对应 commit）${v}`)
          continue
        }
        const remoteTag = tryGit(['rev-list', '-n', '1', `v${v}`])
        if (remoteTag !== null) continue
        if (LEGACY_VERSIONS.has(v)) {
          notes.push(`  （历史遗留，豁免）registry 有 ${v}，GitHub 无 tag`)
          continue
        }
        fail(`registry 上有 ${v}，但 GitHub 没有对应 tag v${v}`,
          `补 tag：git tag v${v} <该版本对应的 commit> && git push origin v${v}`)
      }
    }

    if (remote) notes.push(`仓库：${remote}`)
  } catch (error) {
    fail(`无法查询 npm registry：${error.message}`,
      '断网或代理问题时无法完成对齐校验，请稍后重试')
  }
}

// ---- 5. 发布面必须自洽：清单里声明的每个出处字段都要指向真实仓库 ----
const repository = pkg.repository?.url ?? ''
if (!repository.startsWith('git+https://github.com/')) {
  fail('package.json 缺 repository.url 或不是 GitHub https 形态',
    '补 "repository": { "type": "git", "url": "git+https://github.com/<owner>/<repo>.git" }')
}
if (pkg.publishConfig?.access !== 'public') {
  fail("package.json 缺 publishConfig.access: 'public'", '作用域外的包默认就是 public，但显式声明才不会被误判')
}

// ---- 输出 ----
for (const note of notes) console.log(`  ${note}`)

if (failures.length === 0) {
  console.log(
    process.argv.includes('--verify')
      ? `✅ registry 与 GitHub 对齐：${pkg.name}@${version}（tag ${tagName}）`
      : `✅ 发布前置检查通过：${pkg.name}@${version}，tag ${tagName} 已就位`
  )
  process.exit(0)
}

console.error(`\n❌ 发布校验失败（${failures.length} 项）\n`)
for (const message of failures) console.error(`  - ${message}\n`)
console.error('铁律：Git 先行，npm 后发。\n')
process.exit(1)

#!/usr/bin/env node
/**
 * 产地签名（npm provenance）的判据。纯函数，零 I/O，零依赖。
 *
 * 为什么要单独一个模块：发布后有两个脚本都要问「这个版本带不带产地签名」——
 * verify-release 问 registry 记录，verify-published 问拉回来的字节。
 * 判据必须只有一份，否则一处说有、一处说没有，人只会信不报警的那个。
 * 联网的那两层各自 fetch，把拿到的 JSON 交给这里判。
 *
 * 事实依据（2026-11 实测 vite@8.3.6 与 vite@8.0.0，对照本仓 0.2.0 / 0.2.1）：
 *   - 带 provenance 的版本，registry 文档里 dist.attestations 形如
 *     { url: 'https://registry.npmjs.org/-/npm/v1/attestations/<name>@<version>',
 *       provenance: { predicateType: 'https://slsa.dev/provenance/v1' } }
 *   - 不带 provenance 的版本，dist 里根本没有 attestations 这个键
 *     （0.2.0 曾显式为 null，0.2.1 连键都没有；两种形态含义相同：没做）。
 *   - 那个 url 对不带的版本回 HTTP 404 与 { error: 'Not found' }。
 *   - 端点返回的 attestations 数组通常两条：registry 顺带签的 publish attestation
 *     与我们真正要的那条 SLSA provenance。
 */

/** SLSA provenance 的 predicateType。npm 与 Sigstore 的公开约定，不能改。 */
export const PROVENANCE_PREDICATE = 'https://slsa.dev/provenance/v1';

/** registry 在带 provenance 的发布上额外签的那条 publish attestation。 */
export const PUBLISH_ATTESTATION_PREDICATE =
  'https://github.com/npm/attestation/tree/main/specs/publish/v0.1';

/**
 * 从 registry 文档的 dist 段读出「产地签名指针」。
 *
 * 三种「没有」必须能分开，否则排障时会被当成同一件事：
 *   - 键不存在（最常见的正常形态：这个版本就没发 provenance）；
 *   - 显式为 null（本仓 0.2.0 就是这样）；
 *   - 形态不对（手改过元数据，或换了镜像）。
 *
 * @param {unknown} dist registry 文档里的 versions[版本].dist
 * @returns {{ present: boolean, url: string | null, predicateType: string | null, why: string | null }}
 */
export function readAttestationPointer(dist) {
  if (dist === null || typeof dist !== 'object') {
    return { present: false, url: null, predicateType: null, why: 'dist 段不是一个对象' };
  }
  if (!Object.hasOwn(dist, 'attestations')) {
    return { present: false, url: null, predicateType: null, why: 'dist 段里没有 attestations 键' };
  }
  const pointer = dist.attestations;
  if (pointer === null) {
    return { present: false, url: null, predicateType: null, why: 'attestations 显式为 null' };
  }
  if (typeof pointer !== 'object') {
    return { present: false, url: null, predicateType: null, why: 'attestations 不是对象' };
  }
  const url = typeof pointer.url === 'string' && pointer.url !== '' ? pointer.url : null;
  const provenance = pointer.provenance;
  const predicateType =
    provenance !== null && typeof provenance === 'object' && typeof provenance.predicateType === 'string'
      ? provenance.predicateType
      : null;
  return { present: true, url, predicateType, why: null };
}

/**
 * 判定 attestations 端点返回的 JSON 里到底有没有我们要的那条。
 *
 * 为什么只拿 SLSA 那条当硬门：publish attestation 是 registry 在带 provenance 的
 * 发布上顺带签的实现细节，把判据绑上去等于绑在 registry 内部行为上；
 * 而 SLSA provenance 在，就说明这份字节确实来自一条可追溯的构建流水线。
 *
 * @param {unknown} bundle GET <指针 url> 得到的 JSON
 * @returns {{ ok: boolean, predicateTypes: string[], hasProvenance: boolean, hasPublishAttestation: boolean, why: string | null }}
 */
export function judgeProvenanceBundle(bundle) {
  const absent = (why) => ({
    ok: false,
    predicateTypes: [],
    hasProvenance: false,
    hasPublishAttestation: false,
    why,
  });
  if (bundle === null || typeof bundle !== 'object') return absent('端点返回的不是对象');
  const list = bundle.attestations;
  if (!Array.isArray(list)) return absent('返回体里没有 attestations 数组');
  if (list.length === 0) return absent('attestations 数组是空的');
  const predicateTypes = [];
  for (const item of list) {
    if (item === null || typeof item !== 'object') continue;
    if (typeof item.predicateType === 'string') predicateTypes.push(item.predicateType);
  }
  const hasProvenance = predicateTypes.includes(PROVENANCE_PREDICATE);
  const hasPublishAttestation = predicateTypes.includes(PUBLISH_ATTESTATION_PREDICATE);
  return {
    ok: hasProvenance,
    predicateTypes,
    hasProvenance,
    hasPublishAttestation,
    why: hasProvenance ? null : '这条版本没有 ' + PROVENANCE_PREDICATE + ' 的 attestation',
  };
}

/**
 * 把指针与端点结果合成一句人话。给 verify-published 打印用，不影响退出码。
 *
 * @param {ReturnType<typeof readAttestationPointer>} pointer
 * @param {unknown} bundle 端点 JSON；没取到就传 null
 */
export function describeProvenance(pointer, bundle) {
  if (!pointer.present) return '没有产地签名（' + pointer.why + '）';
  if (bundle === null) return '有产地签名指针，但端点没有取回内容';
  const verdict = judgeProvenanceBundle(bundle);
  if (verdict.ok) return 'SLSA provenance 已签名（' + PROVENANCE_PREDICATE + '）';
  return (
    '有 attestation 但不是 SLSA provenance（见到：' + verdict.predicateTypes.join(', ') + '）'
  );
}

/**
 * 在一批已发布版本上判「产地签名覆盖到哪」。
 *
 * 为什么把判定抽出来而不是写在 verify-release 里：要判的两件事都不需要网络——
 *   - 当前版本必须有 SLSA 指针（没有就是这次发布没签上，必须红）；
 *   - 更早的版本缺不缺只做记录（0.2.2 之前发的都没有，把它们算成失败等于让门禁永远红）。
 * 联网的那一层只负责把每个版本的 dist 取回来喂进来。
 *
 * @param {{ version: string, dist: unknown }[]} entries 已发布版本与各自的 dist 段
 * @param {string} requiredVersion 必须带产地签名的那个版本（当前 package.json 的版本）
 * @returns {{ current: { version: string, present: boolean, predicateType: string | null, why: string | null } | null,
 *   missing: string[], older: string[] }}
 *   current 为 null 表示这批里根本没有当前版本（还没发布）；
 *   missing 是缺产地签名的版本号；older 是缺、但属于历史（不进失败）。
 */
export function judgeProvenanceCoverage(entries, requiredVersion) {
  const missing = [];
  const older = [];
  let current = null;
  for (const entry of entries) {
    const pointer = readAttestationPointer(entry.dist);
    if (entry.version === requiredVersion) {
      current = {
        version: entry.version,
        present: pointer.present,
        predicateType: pointer.predicateType,
        why: pointer.why,
      };
    }
    if (pointer.present) continue;
    missing.push(entry.version);
    if (entry.version !== requiredVersion) older.push(entry.version);
  }
  return { current, missing, older };
}

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PROVENANCE_PREDICATE,
  PUBLISH_ATTESTATION_PREDICATE,
  describeProvenance,
  judgeProvenanceBundle,
  judgeProvenanceCoverage,
  readAttestationPointer,
} from '../scripts/provenance.mjs';

// 夹具照抄 registry 上的真实形态：vite@8.3.6 有指针，本仓 0.2.1 连键都没有。
const SIGNED_DIST = {
  shasum: 'abc',
  integrity: 'sha512-xyz',
  attestations: {
    url: 'https://registry.npmjs.org/-/npm/v1/attestations/demo@1.0.0',
    provenance: { predicateType: PROVENANCE_PREDICATE },
  },
};
const UNSIGNED_DIST = { shasum: 'abc', integrity: 'sha512-xyz' };
const NULL_ATTESTATIONS_DIST = { shasum: 'abc', attestations: null };

const SIGNED_BUNDLE = {
  attestations: [
    { predicateType: PUBLISH_ATTESTATION_PREDICATE },
    { predicateType: PROVENANCE_PREDICATE },
  ],
};

test('指针：带签名时读出 url 与 predicateType', () => {
  const pointer = readAttestationPointer(SIGNED_DIST);
  assert.equal(pointer.present, true);
  assert.equal(pointer.url, 'https://registry.npmjs.org/-/npm/v1/attestations/demo@1.0.0');
  assert.equal(pointer.predicateType, PROVENANCE_PREDICATE);
  assert.equal(pointer.why, null);
});

test('指针：键不存在与显式 null 是两种「没有」，成因要分开报', () => {
  const absent = readAttestationPointer(UNSIGNED_DIST);
  const nulled = readAttestationPointer(NULL_ATTESTATIONS_DIST);
  assert.equal(absent.present, false);
  assert.equal(nulled.present, false);
  assert.match(absent.why, /没有 attestations 键/);
  assert.match(nulled.why, /显式为 null/);
  assert.notEqual(absent.why, nulled.why);
});

test('指针：dist 不是对象、attestations 不是对象都判没有且不抛错', () => {
  assert.equal(readAttestationPointer(null).present, false);
  assert.equal(readAttestationPointer(undefined).present, false);
  assert.equal(readAttestationPointer('sha512-x').present, false);
  const odd = readAttestationPointer({ attestations: 'yes' });
  assert.equal(odd.present, false);
  assert.match(odd.why, /不是对象/);
});

test('指针：有指针但缺 url / 缺 predicateType 时字段为 null，present 仍为真', () => {
  const pointer = readAttestationPointer({ attestations: {} });
  assert.equal(pointer.present, true);
  assert.equal(pointer.url, null);
  assert.equal(pointer.predicateType, null);
});

test('端点：两条 attestation 里只要含 SLSA provenance 就通过，并认出 publish attestation', () => {
  const verdict = judgeProvenanceBundle(SIGNED_BUNDLE);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.hasProvenance, true);
  assert.equal(verdict.hasPublishAttestation, true);
  assert.deepEqual(verdict.predicateTypes, [PUBLISH_ATTESTATION_PREDICATE, PROVENANCE_PREDICATE]);
  assert.equal(verdict.why, null);
});

test('端点：只有 publish attestation 不算通过（判据只认 SLSA provenance）', () => {
  const verdict = judgeProvenanceBundle({ attestations: [{ predicateType: PUBLISH_ATTESTATION_PREDICATE }] });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.hasPublishAttestation, true);
  assert.match(verdict.why, /没有 https:\/\/slsa.dev\/provenance\/v1/);
});

test('端点：空数组、缺数组、非对象、null 全判红且各有成因', () => {
  const cases = [
    [{ attestations: [] }, /数组是空的/],
    [{}, /没有 attestations 数组/],
    [{ attestations: 'x' }, /没有 attestations 数组/],
    [null, /不是对象/],
  ];
  for (const [bundle, pattern] of cases) {
    const verdict = judgeProvenanceBundle(bundle);
    assert.equal(verdict.ok, false);
    assert.match(verdict.why, pattern);
  }
});

test('端点：数组里的非对象项被跳过，不炸也不误判', () => {
  const verdict = judgeProvenanceBundle({ attestations: [null, 3, { predicateType: PROVENANCE_PREDICATE }] });
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.predicateTypes, [PROVENANCE_PREDICATE]);
});

test('覆盖：当前版本带签名时 current.present 为真，older 为空', () => {
  const coverage = judgeProvenanceCoverage(
    [
      { version: '0.2.0', dist: UNSIGNED_DIST },
      { version: '0.2.2', dist: SIGNED_DIST },
    ],
    '0.2.2',
  );
  assert.equal(coverage.current.version, '0.2.2');
  assert.equal(coverage.current.present, true);
  assert.equal(coverage.current.predicateType, PROVENANCE_PREDICATE);
  assert.deepEqual(coverage.missing, ['0.2.0']);
  assert.deepEqual(coverage.older, ['0.2.0']);
});

test('覆盖：当前版本没签名时 present 为假并带成因 —— 门禁就靠这个判红', () => {
  const coverage = judgeProvenanceCoverage([{ version: '0.2.2', dist: UNSIGNED_DIST }], '0.2.2');
  assert.equal(coverage.current.present, false);
  assert.match(coverage.current.why, /没有 attestations 键/);
  assert.deepEqual(coverage.older, []);
});

test('覆盖：这批里没有当前版本时 current 为 null（还没发布的情形）', () => {
  const coverage = judgeProvenanceCoverage([{ version: '0.2.1', dist: UNSIGNED_DIST }], '0.2.2');
  assert.equal(coverage.current, null);
  assert.deepEqual(coverage.older, ['0.2.1']);
});

test('覆盖：全都有签名时 missing 为空 —— 豁免表为空也不会红', () => {
  const coverage = judgeProvenanceCoverage(
    [
      { version: '0.2.1', dist: SIGNED_DIST },
      { version: '0.2.2', dist: SIGNED_DIST },
    ],
    '0.2.2',
  );
  assert.deepEqual(coverage.missing, []);
  assert.deepEqual(coverage.older, []);
});

test('覆盖：版本顺序不影响判定，只看各自 dist', () => {
  const entries = [
    { version: '0.2.2', dist: SIGNED_DIST },
    { version: '0.2.0', dist: NULL_ATTESTATIONS_DIST },
    { version: '0.2.1', dist: UNSIGNED_DIST },
  ];
  const coverage = judgeProvenanceCoverage(entries, '0.2.2');
  assert.equal(coverage.current.present, true);
  assert.deepEqual(coverage.older, ['0.2.0', '0.2.1']);
});

test('人话：四种状态各一句，且都不返回空串', () => {
  assert.match(describeProvenance(readAttestationPointer(UNSIGNED_DIST), null), /^没有产地签名（/);
  assert.match(describeProvenance(readAttestationPointer(SIGNED_DIST), null), /端点没有取回内容/);
  assert.match(
    describeProvenance(readAttestationPointer(SIGNED_DIST), SIGNED_BUNDLE),
    /SLSA provenance 已签名/,
  );
  assert.match(
    describeProvenance(readAttestationPointer(SIGNED_DIST), {
      attestations: [{ predicateType: PUBLISH_ATTESTATION_PREDICATE }],
    }),
    /不是 SLSA provenance（见到：/,
  );
});

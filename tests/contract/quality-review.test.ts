import { it, expect } from 'vitest';
const { validateQualityPanel } = await import(new URL('../../scripts/quality-evidence.mjs', import.meta.url).href);
const weights: Record<string, number> = { onboarding: 20, interaction: 20, visual: 15, feedback: 15, correctness: 10, accessibility: 10, performance: 5, repository: 5 };
const fixture = () => ({ schema_version: '1.0', evidence_class: 'internal_model_panel', status: 'passed', human_usability_observed: false, reviewed_source_sha256: 'source', rubric_sha256: 'rubric', reviewers: [1, 2, 3].map(id => ({ agent: `test-fixture-${id}`, model: 'test-only', fresh_context: true, read_only: true, reviewed_source_sha256: 'source', material_findings: [] as string[], observed_journeys: ['welcome', 'setup', 'repair', 'result', 'resume', 'mobile', 'keyboard'], raw_report: 'evidence/quality/reviews/test-only.txt', total: 100, categories: Object.fromEntries(Object.entries(weights).map(([name, score]) => [name, { score, evidence: 'Unit fixture. No actual reviewer claim.', deduction: 'Unit fixture only.' }])) })) });
it('rejects averaging away one low reviewer, missing categories and totals that exceed actual category scores', () => {
  expect(validateQualityPanel(fixture(), 'source', 'rubric')).toBe(true);
  const low = fixture(); low.reviewers[0]!.categories.onboarding!.score = 9; low.reviewers[0]!.total = 89;
  expect(() => validateQualityPanel(low, 'source', 'rubric')).toThrow(/independently/);
  const missing = fixture(); delete missing.reviewers[0]!.categories.feedback;
  expect(() => validateQualityPanel(missing, 'source', 'rubric')).toThrow(/categories/);
  const inflated = fixture(); inflated.reviewers[0]!.categories.onboarding!.score = 15;
  expect(() => validateQualityPanel(inflated, 'source', 'rubric')).toThrow(/independently/);
});
it('rejects stale source, changed rubric, reused contexts, unexercised product and unresolved defects', () => {
  expect(() => validateQualityPanel(fixture(), 'different-source', 'rubric')).toThrow(/stale/);
  expect(() => validateQualityPanel(fixture(), 'source', 'different-rubric')).toThrow(/stale/);
  const reused = fixture(); reused.reviewers[1]!.agent = reused.reviewers[0]!.agent;
  expect(() => validateQualityPanel(reused, 'source', 'rubric')).toThrow(/contexts/);
  const untested = fixture(); untested.reviewers[0]!.observed_journeys = ['welcome'];
  expect(() => validateQualityPanel(untested, 'source', 'rubric')).toThrow(/incomplete/);
  const defective = fixture(); defective.reviewers[0]!.material_findings = ['Reproducible state loss.'];
  expect(() => validateQualityPanel(defective, 'source', 'rubric')).toThrow(/material/);
});

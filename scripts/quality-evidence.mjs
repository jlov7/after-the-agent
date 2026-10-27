export const qualityWeights = Object.freeze({ onboarding: 20, interaction: 20, visual: 15, feedback: 15, correctness: 10, accessibility: 10, performance: 5, repository: 5 });
export function validateQualityPanel(value, sourceDigest, rubricDigest) {
  if (!value || value.schema_version !== '1.0' || value.evidence_class !== 'internal_model_panel' || value.status !== 'passed' || value.human_usability_observed !== false || value.reviewed_source_sha256 !== sourceDigest || value.rubric_sha256 !== rubricDigest || !Array.isArray(value.reviewers) || value.reviewers.length !== 3) throw new Error('Quality panel is missing, stale or not three internal model reviews.');
  if (new Set(value.reviewers.map(item => item.agent)).size !== 3) throw new Error('Quality reviewers must use three independent fresh contexts.');
  for (const reviewer of value.reviewers) {
    if (typeof reviewer.model !== 'string' || !reviewer.model || reviewer.fresh_context !== true || reviewer.read_only !== true || reviewer.reviewed_source_sha256 !== sourceDigest || !Array.isArray(reviewer.material_findings) || reviewer.material_findings.length || !Array.isArray(reviewer.observed_journeys) || !['welcome', 'setup', 'repair', 'result', 'resume', 'mobile', 'keyboard'].every(name => reviewer.observed_journeys.includes(name)) || typeof reviewer.raw_report !== 'string' || !reviewer.raw_report.startsWith('evidence/quality/reviews/')) throw new Error('Reviewer evidence is incomplete or has unresolved material findings.');
    const categories = reviewer.categories;
    if (!categories || Object.keys(categories).sort().join(',') !== Object.keys(qualityWeights).sort().join(',')) throw new Error('Reviewer changed or omitted rubric categories.');
    let total = 0;
    for (const [name, maximum] of Object.entries(qualityWeights)) {
      const category = categories[name];
      if (!category || !Number.isInteger(category.score) || category.score < 0 || category.score > maximum || typeof category.evidence !== 'string' || !category.evidence.trim() || typeof category.deduction !== 'string' || !category.deduction.trim()) throw new Error('Every category needs an in-range score, observed evidence and a deduction explanation.');
      total += category.score;
    }
    if (reviewer.total !== total || total < 90) throw new Error('Each reviewer must independently reach 90 on the unchanged rubric.');
  }
  return true;
}

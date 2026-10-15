// Scores a reviewer's grades of free-text fields (see grading.js) as labels: each graded
// field is one label out of faithful / invented / missing. Pure: grades in, numbers out.
//
//   invented rate - of the fields graded, the share that say something the source does not
//                   support. The serious error (high): a form that reads plausibly and says
//                   something the person never said
//   missing rate  - of the fields graded, the share that leave out something the source says
//                   (medium: incomplete, not false)
//   forms with an invented field - of the forms with every field graded, the share with at
//                   least one invented field: how often a whole form needs correcting
// Per field and per section. A section pools its fields' grades, so its rates count fields,
// not forms (trap J11). Every rate carries its likely range, as everywhere else.
//
// agreementOf compares two reviewers' grades of the same forms: observed agreement, Cohen's
// kappa over the three grades, kappa on "invented or not" alone, and every disagreement.

const { rate, cohensKappa } = require('./stats.js');
const { GRADES } = require('../grading.js');

const SEVERITY = { invented: 'high', missing: 'medium' };

function rates(list) {
  const count = g => list.filter(x => x.grade === g).length;
  return { graded: list.length, faithful: rate(count('faithful'), list.length), invented: rate(count('invented'), list.length), missing: rate(count('missing'), list.length) };
}

// g: what readGrades returned.
function scoreGrades(g) {
  const all = [...g.grades.values()];
  const sectionOf = new Map(g.fields.map(f => [f.name, f.section]));
  const fields = g.fields.map(f => ({ name: f.name, section: f.section, ...rates(all.filter(x => x.field === f.name)) }));
  const sectionNames = [...new Set(g.fields.map(f => f.section).filter(s => s !== null))];
  const sections = sectionNames.map(s => ({ section: s, fields: g.fields.filter(f => f.section === s).map(f => f.name), ...rates(all.filter(x => sectionOf.get(x.field) === s)) }));

  // Forms: only those with every field graded, so "no invented field" is known, not assumed.
  const perForm = g.forms.map(form => {
    const mine = all.filter(x => x.form === form);
    return { form, graded: mine.length, of: g.fields.length, invented: mine.filter(x => x.grade === 'invented').length, missing: mine.filter(x => x.grade === 'missing').length };
  });
  const complete = perForm.filter(f => f.graded === f.of);

  const listOf = grade => all.filter(x => x.grade === grade).map(x => ({ form: x.form, field: x.field, section: sectionOf.get(x.field), kinds: x.kinds, note: x.note }));
  const invented = listOf('invented');
  const kinds = {};
  for (const k of g.kinds) kinds[k] = invented.filter(x => x.kinds.includes(k)).length;

  return {
    reviewer: g.reviewer,
    fingerprint: g.fingerprint,
    title: g.title,
    severity: SEVERITY,
    overall: rates(all),
    fields,
    sections,
    forms: {
      with_invented: rate(complete.filter(f => f.invented > 0).length, complete.length),
      partly_graded: perForm.filter(f => f.graded < f.of).map(f => f.form),
      per_form: perForm,
    },
    invented,
    missing: listOf('missing'),
    kinds: { counts: kinds, none_given: invented.filter(x => x.kinds.length === 0).length },
    ungraded: g.ungraded,
  };
}

// a, b: two readGrades results for the same forms (the caller checks they are).
function agreementOf(a, b) {
  const matrix = {};
  for (const x of GRADES) { matrix[x] = {}; for (const y of GRADES) matrix[x][y] = 0; }
  const binary = { yes: { yes: 0, no: 0 }, no: { yes: 0, no: 0 } };
  const disagreements = [];
  let compared = 0;
  let onlyOne = 0;
  for (const form of a.forms) {
    for (const f of a.fields) {
      const k = form + '\u0000' + f.name;
      const ga = a.grades.get(k);
      const gb = b.grades.get(k);
      if (!ga || !gb) { if (ga || gb) onlyOne++; continue; }
      compared++;
      matrix[ga.grade][gb.grade]++;
      binary[ga.grade === 'invented' ? 'yes' : 'no'][gb.grade === 'invented' ? 'yes' : 'no']++;
      if (ga.grade !== gb.grade) disagreements.push({ form, field: f.name, first: ga.grade, second: gb.grade, first_note: ga.note, second_note: gb.note });
    }
  }
  const agreed = GRADES.reduce((s, x) => s + matrix[x][x], 0);
  return {
    first: a.reviewer, second: b.reviewer,
    compared,
    graded_by_one_only: onlyOne,
    observed: rate(agreed, compared),
    kappa: cohensKappa(matrix, GRADES),
    invented_kappa: cohensKappa(binary, ['yes', 'no']),
    invented_observed: rate(binary.yes.yes + binary.no.no, compared),
    confusion: matrix,
    disagreements,
  };
}

module.exports = { scoreGrades, agreementOf, SEVERITY };

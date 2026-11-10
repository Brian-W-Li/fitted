/** Shared vote/reason projection for History, reducers and export. No database dependencies. */
const FEEDBACK_ACCOUNT_ROW_LIMIT = 2000;
const REASON_AMENDMENT = "reason_amendment";
const LEARNING_DISPOSITION = "learning_disposition";
const voteEvidenceFilter = { eventKind: { $nin: [REASON_AMENDMENT, LEARNING_DISPOSITION] } };

function text(value) { return value == null ? "" : String(value); }
function sameBinding(vote, amendment) {
  if (!text(vote.user) || text(vote.user) !== text(amendment.user)) return false;
  for (const key of ["snapshotId", "candidateId", "baseKey", "fullSignature"]) {
    if (!text(vote[key]) || text(vote[key]) !== text(amendment[key])) return false;
  }
  const left = (vote.items ?? []).map(text);
  const right = (amendment.items ?? []).map(text);
  return left.length === right.length && left.every((item, index) => item === right[index]);
}
function newer(a, b) {
  const time = row => { const value = new Date(row.createdAt ?? 0).getTime(); return Number.isNaN(value) ? 0 : value; };
  return time(a) > time(b) || (time(a) === time(b) && text(a._id) > text(b._id));
}

/** Reasons replace only reasons, never vote identity, ordering, ownership or composition. */
function resolveFeedbackEvidence(votes, amendments) {
  const voteRows = votes.filter(row => row.eventKind !== REASON_AMENDMENT && row.eventKind !== LEARNING_DISPOSITION);
  const parents = new Map(voteRows.filter(row => ["accepted", "rejected"].includes(row.action) && text(row._id))
    .map(row => [text(row._id), row]));
  const latest = new Map();
  for (const amendment of amendments) {
    if (amendment.eventKind !== REASON_AMENDMENT) continue;
    const key = text(amendment.reactionId), parent = parents.get(key);
    if (!parent || !sameBinding(parent, amendment)) continue;
    // Accepted outfits may have scoped reservations, never legacy dislike enrichment.
    if (parent.action === "accepted" && ((amendment.perItemFeedback ?? []).length ||
        (amendment.feedbackReason && !amendment.feedbackReason.scope))) continue;
    const prior = latest.get(key);
    if (!prior || newer(amendment, prior)) latest.set(key, amendment);
  }
  const reasonRows = voteRows.map(vote => {
    const amendment = latest.get(text(vote._id));
    if (!amendment) return vote;
    const effective = { ...vote };
    // Absence in an amendment clears the prior value; it must not silently resurrect old reasons.
    for (const key of ["feedbackReason", "perItemFeedback"]) {
      delete effective[key];
      if (Object.prototype.hasOwnProperty.call(amendment, key)) effective[key] = amendment[key];
    }
    return effective;
  });
  return resolveLearningDispositions(reasonRows, amendments);
}

/** Disposition revisions change eligibility, never vote time, sign, scope or identity. */
function resolveLearningDispositions(votes, amendments) {
  const parents = new Map(votes.map(row => [text(row._id), row]));
  const latest = new Map();
  for (const amendment of amendments) {
    if (amendment.eventKind !== LEARNING_DISPOSITION || !Number.isSafeInteger(amendment.dispositionRevision) || amendment.dispositionRevision < 1 ||
      !["normal", "exception", "do_not_learn"].includes(amendment.learningDisposition)) continue;
    const key = text(amendment.reactionId), parent = parents.get(key);
    if (!parent || !sameBinding(parent, amendment)) continue;
    const prior = latest.get(key);
    if (!prior || amendment.dispositionRevision > prior.dispositionRevision ||
      (amendment.dispositionRevision === prior.dispositionRevision && newer(amendment, prior))) latest.set(key, amendment);
  }
  return votes.map(vote => {
    const amendment = latest.get(text(vote._id));
    return amendment ? { ...vote, learningDisposition: amendment.learningDisposition, dispositionRevision: amendment.dispositionRevision } : vote;
  });
}
module.exports = { FEEDBACK_ACCOUNT_ROW_LIMIT, REASON_AMENDMENT, LEARNING_DISPOSITION, voteEvidenceFilter, resolveFeedbackEvidence, resolveLearningDispositions };

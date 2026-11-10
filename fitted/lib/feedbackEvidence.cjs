/** Shared vote/reason projection for History, reducers and export. No database dependencies. */
const FEEDBACK_ACCOUNT_ROW_LIMIT = 2000;
const REASON_AMENDMENT = "reason_amendment";
const voteEvidenceFilter = { eventKind: { $ne: REASON_AMENDMENT } };

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
  const voteRows = votes.filter(row => row.eventKind !== REASON_AMENDMENT);
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
  return voteRows.map(vote => {
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
}
module.exports = { FEEDBACK_ACCOUNT_ROW_LIMIT, REASON_AMENDMENT, voteEvidenceFilter, resolveFeedbackEvidence };

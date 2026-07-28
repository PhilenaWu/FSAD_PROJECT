// Maps a 0-100 priority score (the same scale as inspections.ai_priority_score)
// to the inspections.priority label enum (migration 004 CHECK). Even quartile
// split — no existing convention to mirror, since ai_priority_score has so far
// only been used as a raw ranking signal (analyticsController's priority
// queue), never converted into a priority label.
'use strict';

function priorityFromScore(score) {
  if (score <= 25) return 'Low';
  if (score <= 50) return 'Medium';
  if (score <= 75) return 'High';
  return 'Critical';
}

module.exports = { priorityFromScore };

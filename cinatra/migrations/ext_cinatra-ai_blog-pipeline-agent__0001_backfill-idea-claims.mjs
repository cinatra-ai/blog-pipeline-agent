/**
 * Data-only upgrade. The host creates both declared tables and the claim index
 * before this module runs under the package's SELECT/INSERT/UPDATE/DELETE role.
 * App must quiesce every legacy writer and reissue stale offers before the
 * migration and activation; this transaction lock does not fence later writers.
 * A single drafted row wins over one live stale reservation for the same org
 * and idea. Release only that reservation; keep its original legacy provenance.
 * Duplicate drafts or live reservations still refuse the entire activation.
 * Queue every statement: the runner owns the transaction and applied ledger.
 */
export function up(pgm) {
  pgm.sql(`LOCK TABLE ext_cinatra_ai_blog_pipeline_agent_idea_drafts,
    ext_cinatra_ai_blog_pipeline_agent_idea_claims IN SHARE ROW EXCLUSIVE MODE`);
  pgm.sql(`DO $backfill$
  BEGIN
    IF EXISTS (SELECT 1 FROM ext_cinatra_ai_blog_pipeline_agent_idea_claims) THEN
      RAISE EXCEPTION 'Idea claim target is not empty; refusing an ambiguous backfill';
    END IF;
    IF EXISTS (
      SELECT 1 FROM ext_cinatra_ai_blog_pipeline_agent_idea_drafts
      WHERE org_id IS NULL OR btrim(org_id) = '' OR run_id IS NULL OR btrim(run_id) = ''
        OR idea_artifact_id IS NULL OR btrim(idea_artifact_id) = ''
        OR idea_revision_id IS NULL OR btrim(idea_revision_id) = ''
        OR created_at IS NULL OR state IS NULL OR state NOT IN ('reserved', 'drafted', 'released')
        OR (state = 'reserved' AND (expires_at IS NULL OR draft_artifact_id IS NOT NULL))
        OR (state = 'drafted' AND (draft_artifact_id IS NULL OR btrim(draft_artifact_id) = ''
          OR expires_at IS NOT NULL))
    ) THEN
      RAISE EXCEPTION 'Unknown or incomplete legacy idea history; refusing activation';
    END IF;
    IF EXISTS (
      SELECT org_id, idea_artifact_id FROM ext_cinatra_ai_blog_pipeline_agent_idea_drafts
      WHERE state = 'drafted' OR (state = 'reserved' AND expires_at > CURRENT_TIMESTAMP)
      GROUP BY org_id, idea_artifact_id
      HAVING count(*) FILTER (WHERE state = 'drafted') > 1
        OR count(*) FILTER (WHERE state = 'reserved') > 1
    ) THEN
      RAISE EXCEPTION 'Conflicting active legacy idea history; refusing activation';
    END IF;
    INSERT INTO ext_cinatra_ai_blog_pipeline_agent_idea_claims
      (org_id, run_id, idea_artifact_id, idea_revision_id, state, draft_artifact_id,
        expires_at, created_at, active_idea_key, legacy_state, legacy_expires_at)
    SELECT org_id, run_id, idea_artifact_id, idea_revision_id,
      CASE WHEN release_reservation THEN 'released' ELSE state END,
      draft_artifact_id,
      CASE WHEN state = 'reserved' AND NOT release_reservation THEN expires_at ELSE NULL END,
      created_at,
      CASE WHEN state = 'drafted' OR (state = 'reserved' AND NOT release_reservation)
        THEN idea_artifact_id ELSE NULL END,
      state, expires_at
    FROM (
      SELECT legacy.*,
        legacy.state = 'reserved' AND (
          legacy.expires_at <= CURRENT_TIMESTAMP OR EXISTS (
            SELECT 1 FROM ext_cinatra_ai_blog_pipeline_agent_idea_drafts AS drafted
            WHERE drafted.org_id = legacy.org_id
              AND drafted.idea_artifact_id = legacy.idea_artifact_id
              AND drafted.state = 'drafted'
          )
        ) AS release_reservation
      FROM ext_cinatra_ai_blog_pipeline_agent_idea_drafts AS legacy
    ) AS classified;
  END;
  $backfill$;`);
}

// History is append-only; no down path deletes claims or legacy draft relations.
export const down = false;

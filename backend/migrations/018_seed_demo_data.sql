-- Migration: Seed demo data for the UC-005 analytics dashboard.
-- Inspections shaped so every dashboard widget has data: open records
-- (heatmap / trends / priority queue), assigned jobs with some overdue
-- (contractor scorecard), closed records with resolution times (SLA gauge —
-- 42 of 55 within the 72h target = 76.4%), and two active ai_predictions
-- rows (AI alert cards).
--
-- Contractors come from 016_seed_reference_data.sql (UC-001) — this file
-- reuses them by name rather than creating rivals, and inserts them only if
-- 016 has not run (same WHERE NOT EXISTS pattern, so either order is safe).
-- resident_id / inspector_id stay NULL: users.id must reference a real
-- Supabase auth account, and the analytics queries never read originators.
-- Idempotent: skipped entirely when 'Demo:' rows already exist.

-- Ensure the three brand contractors exist (no-ops after 016).
INSERT INTO contractors (name, brands_serviced, contact_email)
SELECT 'Otis Service SG', 'Otis', 'defects@otis-sg.example.com'
WHERE NOT EXISTS (SELECT 1 FROM contractors WHERE name = 'Otis Service SG');

INSERT INTO contractors (name, brands_serviced, contact_email)
SELECT 'Schindler Care', 'Schindler', 'alerts@schindlercare.example.com'
WHERE NOT EXISTS (SELECT 1 FROM contractors WHERE name = 'Schindler Care');

INSERT INTO contractors (name, brands_serviced, contact_email)
SELECT 'KONE Maintenance', 'KONE', 'service@kone-maint.example.com'
WHERE NOT EXISTS (SELECT 1 FROM contractors WHERE name = 'KONE Maintenance');

DO $$
DECLARE
  otis  UUID;
  schin UUID;
  kone  UUID;
BEGIN
  -- Marker guard: seed once, skip on re-runs.
  IF EXISTS (SELECT 1 FROM inspections WHERE title LIKE 'Demo:%') THEN
    RETURN;
  END IF;

  SELECT id INTO otis  FROM contractors WHERE name = 'Otis Service SG';
  SELECT id INTO schin FROM contractors WHERE name = 'Schindler Care';
  SELECT id INTO kone  FROM contractors WHERE name = 'KONE Maintenance';

  -- A) Open records — block × category spread for the heatmap; created_at
  -- spread over the last 14 days so the trend line has shape.
  INSERT INTO inspections
    (source_type, title, location_block, category, priority, ai_priority_score,
     status, source_flag, created_at)
  SELECT
    'resident_complaint',
    'Demo: ' || d.category || ' issue ' || g || ' at Blk ' || d.block,
    d.block,
    d.category,
    CASE WHEN g % 5 = 0 THEN 'Critical' WHEN g % 2 = 0 THEN 'High' ELSE 'Medium' END,
    35 + ((g * 13) % 60),
    CASE WHEN g % 3 = 0 THEN 'Pending Assignment' ELSE 'Open' END,
    'Resident',
    NOW() - ((g * 5) % 14 || ' days')::interval - ((g * 7) % 24 || ' hours')::interval
  FROM (VALUES
    ('44A', 'Lift',        9),
    ('44A', 'Electrical',  3),
    ('44A', 'Cleanliness', 2),
    ('44B', 'Lift',        4),
    ('44B', 'Plumbing',    6),
    ('44B', 'Doors',       2),
    ('88B', 'Plumbing',    7),
    ('88B', 'Lift',        2),
    ('88B', 'Safety',      1),
    ('90C', 'Cleanliness', 5),
    ('90C', 'Electrical',  4),
    ('90C', 'Lift',        1)
  ) AS d(block, category, cnt)
  CROSS JOIN LATERAL generate_series(1, d.cnt) AS g;

  -- B) Assigned jobs per contractor for the scorecard's overdue column:
  -- the first `overdue` of each contractor's jobs have a past deadline.
  INSERT INTO inspections
    (source_type, title, location_block, category, priority, ai_priority_score,
     status, contractor_id, target_deadline, acknowledged_at, source_flag, created_at)
  SELECT
    'lift_inspection',
    'Demo: assigned lift defect ' || g || ' at Blk ' || a.block,
    a.block,
    'Lift',
    'High',
    60 + g,
    'Acknowledged',
    a.cid,
    CASE WHEN g <= a.overdue
         THEN NOW() - INTERVAL '3 days'
         ELSE NOW() + INTERVAL '10 days' END,
    NOW() - INTERVAL '5 days',
    'Inspector',
    NOW() - INTERVAL '8 days'
  FROM (VALUES
    (otis,  4, 1, '44A'),
    (schin, 5, 3, '44B'),
    (kone,  3, 0, '88B')
  ) AS a(cid, jobs, overdue, block)
  CROSS JOIN LATERAL generate_series(1, a.jobs) AS g;

  -- C) Closed records: 55 total, 42 within the 72h SLA (30–69h) and 13 over
  -- (80–119h) → 76.4% compliance. Rectification gaps differ per contractor
  -- (~3 / ~4 / ~7 days) so the scorecard averages spread. actual_cost feeds
  -- the future UC-011 cost dashboard.
  INSERT INTO inspections
    (source_type, title, location_block, category, priority, status,
     contractor_id, acknowledged_at, rectified_at, is_deleted, closing_remark,
     resolution_time_hours, actual_cost, closed_at, created_at, source_flag)
  SELECT
    'resident_complaint',
    'Demo: closed record ' || g,
    (ARRAY['44A','44B','88B','90C'])[1 + (g % 4)],
    (ARRAY['Lift','Plumbing','Electrical','Cleanliness','Doors'])[1 + (g % 5)],
    (ARRAY['High','Medium','Low'])[1 + (g % 3)],
    'Closed',
    (ARRAY[otis, schin, kone])[1 + (g % 3)],
    c.created + INTERVAL '1 day',
    c.created + INTERVAL '1 day' + ((ARRAY[3, 4, 7])[1 + (g % 3)] || ' days')::interval,
    TRUE,
    'Demo closure — verified fixed.',
    c.res_hours,
    150 + ((g * 37) % 600),
    c.created + (c.res_hours || ' hours')::interval,
    c.created,
    'Resident'
  FROM generate_series(1, 55) AS g
  CROSS JOIN LATERAL (
    SELECT
      CASE WHEN g <= 42 THEN 30 + ((g * 11) % 40)   -- compliant: ≤ 72h
           ELSE 80 + ((g * 11) % 40) END            -- breached: > 72h
        AS res_hours,
      NOW() - ((15 + (g % 30)) || ' days')::interval AS created
  ) AS c;

  -- D) Active AI risk alerts for the dashboard cards.
  INSERT INTO ai_predictions (location_block, category, velocity_pct, alert_text, status) VALUES
    ('44A', 'Lift', 60.0,
     'Block 44A lift failures have increased 60% in 30 days. Recommend preventive inspection before end of month — est. $800 now vs $3,200 for reactive repair later.',
     'Active'),
    ('88B', 'Plumbing', 45.0,
     'Block 88B plumbing complaints up 45% vs prior period. Inspect riser pipes before wet season — projected cost impact $1,200.',
     'Active');
END $$;

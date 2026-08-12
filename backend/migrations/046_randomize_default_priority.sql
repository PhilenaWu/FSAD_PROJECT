-- Migration: Randomize priority on inspections still at the column default.
-- Most records (AI-generated preventive maintenance, demo inspector/resident
-- data) were inserted without a priority or ai_priority_score, so everything
-- sat at the default 'Medium' and the priority queue looked flat.
-- Give each a weighted-random score (few Low/Critical, mostly Medium/High) and
-- derive the label with the same quartiles as src/utils/priorityFromScore.js.
-- Re-run safe: only touches rows still in the untouched default state
-- (priority = 'Medium' AND ai_priority_score IS NULL), which this UPDATE ends.

WITH scored AS (
  SELECT
    id,
    -- r picks the priority band (15% Low, 40% Medium, 30% High, 15% Critical),
    -- p picks a score within that band's 25-point range.
    CASE
      WHEN r < 0.15 THEN 1  + floor(p * 25)  -- Low:      1-25
      WHEN r < 0.55 THEN 26 + floor(p * 25)  -- Medium:  26-50
      WHEN r < 0.85 THEN 51 + floor(p * 25)  -- High:    51-75
      ELSE               76 + floor(p * 25)  -- Critical: 76-100
    END::int AS score
  FROM (
    SELECT id, random() AS r, random() AS p
    FROM inspections
    WHERE priority = 'Medium'
      AND ai_priority_score IS NULL
  ) draw
)
UPDATE inspections i
SET ai_priority_score = s.score,
    priority = CASE
      WHEN s.score <= 25 THEN 'Low'
      WHEN s.score <= 50 THEN 'Medium'
      WHEN s.score <= 75 THEN 'High'
      ELSE 'Critical'
    END
FROM scored s
WHERE i.id = s.id;

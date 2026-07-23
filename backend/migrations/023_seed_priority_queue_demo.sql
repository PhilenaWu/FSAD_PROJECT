-- Migration: Seed extra Critical and Low priority open records so the
-- manager dashboard's priority queue shows the full colour range
-- (Critical dark red ... Low yellow). Display-only demo data, same style as
-- 018_seed_demo_data.sql. Idempotent via the 'Demo PQ:' title marker.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM inspections WHERE title LIKE 'Demo PQ:%') THEN
    RETURN;
  END IF;

  INSERT INTO inspections
    (source_type, title, location_block, category, priority, ai_priority_score,
     status, source_flag, created_at)
  VALUES
    -- Critical — high scores, recent, so they rank at the top of the queue.
    ('resident_complaint', 'Demo PQ: Lift trapped resident report at Blk 44A',
     '44A', 'Lift', 'Critical', 95, 'Open', 'Resident', NOW() - INTERVAL '2 hours'),
    ('resident_complaint', 'Demo PQ: Exposed live wiring at Blk 88B void deck',
     '88B', 'Electrical', 'Critical', 92, 'Pending Assignment', 'Resident', NOW() - INTERVAL '6 hours'),
    ('resident_complaint', 'Demo PQ: Burst riser pipe flooding Blk 44B lobby',
     '44B', 'Plumbing', 'Critical', 90, 'Open', 'Resident', NOW() - INTERVAL '1 day'),
    -- Low — low scores, older, so they sit at the bottom of the queue.
    ('resident_complaint', 'Demo PQ: Faded corridor paint at Blk 90C',
     '90C', 'Cleanliness', 'Low', 12, 'Open', 'Resident', NOW() - INTERVAL '10 days'),
    ('resident_complaint', 'Demo PQ: Squeaky stairwell door at Blk 44A',
     '44A', 'Doors', 'Low', 15, 'Open', 'Resident', NOW() - INTERVAL '8 days'),
    ('resident_complaint', 'Demo PQ: Overgrown shrubs near Blk 88B carpark',
     '88B', 'Landscaping', 'Low', 10, 'Pending Assignment', 'Resident', NOW() - INTERVAL '12 days');
END $$;

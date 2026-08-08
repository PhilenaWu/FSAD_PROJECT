-- Migration: [DEPRECATED] Demo data for UC-005 analytics dashboard.
-- Replaced by migration 044_delete_demo_records.sql which cleans up any
-- existing demo records. No-op: all demo seeding is now disabled.
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

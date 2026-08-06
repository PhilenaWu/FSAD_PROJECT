// Eases a numeric KPI value up from its previous value on change instead of
// jumping straight to the new one, so dashboard refreshes feel alive. Purely
// presentational — falls straight through to the raw value for non-numbers
// ('—', already-composed strings like "+4% vs prior period") so callers don't
// need a special case for those.
import { useEffect, useRef, useState } from 'react';

const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);

export default function AnimatedNumber({ value, format = (n) => Math.round(n).toLocaleString(), duration = 500 }) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(typeof value === 'number' ? value : 0);

  useEffect(() => {
    if (typeof value !== 'number' || Number.isNaN(value)) return;
    const from = fromRef.current;
    const to = value;
    const start = performance.now();
    let frame;
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      setDisplay(from + (to - from) * easeOutQuad(t));
      if (t < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  if (typeof value !== 'number' || Number.isNaN(value)) return value ?? '—';
  return format(display);
}

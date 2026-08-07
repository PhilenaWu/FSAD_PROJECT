// Shared estate block list, extracted from ReportIssuePage so the registration
// form offers exactly the same options rather than a second hand-written list.
// Placeholder data until a real blocks source exists.
export const BLOCKS = ['44A', '44B', '44C', '45A', '45B'];

// Approximate centre of each block, same placeholder status as BLOCKS above.
// Only used to SUGGEST a block from the user's GPS fix — the suggestion is
// never written into the form, so bad coordinates can only produce a bad hint.
const BLOCK_COORDS = {
  '44A': { lat: 1.3521, lng: 103.8198 },
  '44B': { lat: 1.3525, lng: 103.8203 },
  '44C': { lat: 1.3529, lng: 103.8208 },
  '45A': { lat: 1.3534, lng: 103.8194 },
  '45B': { lat: 1.3538, lng: 103.8199 },
};

// Closest block to a { lat, lng } fix. Plain squared-degree distance — over a
// few hundred metres it ranks the same as a proper great-circle distance, and
// we only need the ranking, not the number.
export function nearestBlock({ lat, lng }) {
  let closest = null;
  let best = Infinity;
  for (const [block, coord] of Object.entries(BLOCK_COORDS)) {
    const d = (coord.lat - lat) ** 2 + (coord.lng - lng) ** 2;
    if (d < best) {
      best = d;
      closest = block;
    }
  }
  return closest;
}

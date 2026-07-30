// UC-011 shared currency formatting.
// "$18,240.50" — SGD operational maintenance costs. Shared by every cost
// panel so one number never formats differently from another.
export const fmtMoney = (n) =>
  n == null
    ? '—'
    : `$${Number(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

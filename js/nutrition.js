// Missing workbook values remain unknown, including after portion scaling.
export function scaleNutrient(value, quantity) {
  return typeof value === 'number' && Number.isFinite(value) ? value * quantity : null;
}

export function formatNutrient(value, digits = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
}

export function sumNutrition(logs) {
  const totals = { cal: 0, protein: 0, carbs: 0, fat: 0, missing: {} };
  for (const key of ['cal', 'protein', 'carbs', 'fat']) {
    totals.missing[key] = false;
    for (const log of logs) {
      if (typeof log[key] === 'number' && Number.isFinite(log[key])) totals[key] += log[key];
      else totals.missing[key] = true;
    }
  }
  return totals;
}

export function getCurrentQuarter() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const quarter = Math.floor(month / 3) + 1;
  return {
    year,
    quarter,
    label: `Q${quarter} ${year}`
  };
}

export function getNextQuarter() {
  const current = getCurrentQuarter();
  let { year, quarter } = current;

  quarter++;
  if (quarter > 4) {
    quarter = 1;
    year++;
  }

  return {
    year,
    quarter,
    label: `Q${quarter} ${year}`
  };
}

export function quarterLabel(year, quarter) {
  return `Q${quarter} ${year}`;
}
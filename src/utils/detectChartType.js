export function detectChartType(column, values) {
  if (values.every(v => typeof v === "number")) return "bar";
  if (values.length < 10) return "pie";
  return "table";
}

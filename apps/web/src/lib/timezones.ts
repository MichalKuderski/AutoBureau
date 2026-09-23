/** Common US choices; retain any valid timezone already saved on an account. */
export function timezoneOptions(current: string) {
  const values = [
    ["America/New_York", "Eastern (New York)"],
    ["America/Chicago", "Central (Chicago)"],
    ["America/Denver", "Mountain (Denver)"],
    ["America/Phoenix", "Arizona (Phoenix)"],
    ["America/Los_Angeles", "Pacific (Los Angeles)"],
    ["America/Anchorage", "Alaska (Anchorage)"],
    ["Pacific/Honolulu", "Hawaii (Honolulu)"],
  ].map(([value, label]) => ({ value: value!, label: label! }));
  return values.some((option) => option.value === current)
    ? values : [{ value: current, label: current }, ...values];
}

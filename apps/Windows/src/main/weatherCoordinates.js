function normalizeWeatherCoordinates(location) {
  const rawLatitude = location?.latitude;
  const rawLongitude = location?.longitude;
  const latitude = Number(rawLatitude);
  const longitude = Number(rawLongitude);
  const missing = rawLatitude === undefined || rawLatitude === null || rawLatitude === ""
    || rawLongitude === undefined || rawLongitude === null || rawLongitude === "";

  if (
    missing
    || !Number.isFinite(latitude)
    || !Number.isFinite(longitude)
    || latitude < -90
    || latitude > 90
    || longitude < -180
    || longitude > 180
  ) {
    throw new Error("Invalid weather coordinates");
  }

  return { latitude, longitude };
}

module.exports = { normalizeWeatherCoordinates };

// Location writes must reach the backend in selection order. Only the newest
// operation may broadcast a result; superseded callers receive null.
function createWeatherOperations({ invalidate, publish }) {
  let tail = Promise.resolve();
  let version = 0;
  return {
    invalidate() { version += 1; invalidate(); },
    run(operation) {
      const request = ++version;
      invalidate();
      const pending = tail.then(async () => {
        let result;
        try {
          result = await operation();
        } finally {
          invalidate();
        }
        if (request !== version) return null;
        publish(result);
        return result;
      });
      tail = pending.catch(() => {});
      return pending;
    }
  };
}

module.exports = { createWeatherOperations };

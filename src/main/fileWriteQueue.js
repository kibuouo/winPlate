const pendingWrites = new Map();

function serializeFileWrite(target, operation) {
  const previous = pendingWrites.get(target) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  pendingWrites.set(target, current);

  return current.finally(() => {
    if (pendingWrites.get(target) === current) {
      pendingWrites.delete(target);
    }
  });
}

module.exports = { serializeFileWrite };

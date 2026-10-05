let sequence = 0;

function nextId(prefix = 'id') {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

function resetIdSequenceForTest() {
  sequence = 0;
}

export { nextId, resetIdSequenceForTest };

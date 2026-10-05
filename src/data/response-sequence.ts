let responseSequence = 0;

/** Runtime ordering of accepted source responses, never a source timestamp. */
export function nextResponseSequence(): number {
  return ++responseSequence;
}

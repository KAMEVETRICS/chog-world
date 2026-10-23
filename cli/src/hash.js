// Derived from Chog World cult/src/engine/hash.ts. Parity is checked by tests.
/** 32-bit FNV-1a: a small, stable hash so tie-breaks and fixtures are identical everywhere without dependencies. */
export function stableHash(text) {
    let hash = 0x811c9dc5;
    for (const byte of new TextEncoder().encode(text)) {
        hash ^= byte;
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash;
}

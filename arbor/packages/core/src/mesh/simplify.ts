import type { Skeleton } from '../types.js';

/**
 * Collapse runs of nearly collinear, non-branching metamers into single segments before meshing.
 * A node is kept if it is the root, a tip, a branching point, the first node of a lateral, or if
 * dropping it would deviate the chain by more than `angleDeg` or grow a segment beyond `maxLength`.
 * Returns a new skeleton plus a map from new index to old index (leaves keep referencing the full skeleton).
 */
export function simplifySkeleton(sk: Skeleton, angleDeg = 6, maxLength = 1.5): { skeleton: Skeleton; oldIndex: Int32Array } {
  const n = sk.count;
  const P = sk.position;
  const childCount = new Int32Array(n);
  for (let i = 1; i < n; i++) childCount[sk.parent[i]]++;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  const cosTol = Math.cos((angleDeg * Math.PI) / 180);
  // last kept ancestor per node, and the direction/length of the segment being accumulated
  const lastKept = new Int32Array(n);
  const segLen = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    const p = sk.parent[i];
    const anchor = keep[p] ? p : lastKept[p];
    // direction from anchor to this node vs direction from anchor to parent (the chain so far)
    const ax = P[i * 3] - P[anchor * 3], ay = P[i * 3 + 1] - P[anchor * 3 + 1], az = P[i * 3 + 2] - P[anchor * 3 + 2];
    const bx = P[p * 3] - P[anchor * 3], by = P[p * 3 + 1] - P[anchor * 3 + 1], bz = P[p * 3 + 2] - P[anchor * 3 + 2];
    const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz);
    let straight = true;
    if (lb > 1e-6 && la > 1e-6) straight = (ax * bx + ay * by + az * bz) / (la * lb) >= cosTol;
    const mustKeep = sk.isTip[i] || childCount[i] !== 1 || !sk.isMain[i] || (!keep[p] && childCount[p] !== 1) || sk.dead[i] !== sk.dead[p];
    if (mustKeep || !straight || la > maxLength || sk.radius[p] > sk.radius[i] * 1.25) {
      // keep the parent if it was dropped and this node bends away from the accumulated chain
      if (!keep[p] && (!straight || la > maxLength)) keep[p] = 1;
      keep[i] = 1;
    }
    lastKept[i] = keep[i] ? i : anchor;
    segLen[i] = keep[i] ? 0 : la;
  }
  // parents of kept nodes must be resolvable: remap to last kept ancestor
  let count = 0;
  const remap = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) if (keep[i]) remap[i] = count++;
  const out: Skeleton = {
    count,
    parent: new Int32Array(count),
    position: new Float32Array(count * 3),
    birthYear: new Uint16Array(count),
    order: new Uint8Array(count),
    strands: new Uint32Array(count),
    radius: new Float32Array(count),
    isMain: new Uint8Array(count),
    isTip: new Uint8Array(count),
    dead: new Uint8Array(count),
  };
  const oldIndex = new Int32Array(count);
  for (let i = 0; i < n; i++) {
    const j = remap[i]; if (j < 0) continue;
    let p = sk.parent[i];
    while (p >= 0 && !keep[p]) p = sk.parent[p];
    out.parent[j] = p < 0 ? -1 : remap[p];
    out.position[j * 3] = P[i * 3]; out.position[j * 3 + 1] = P[i * 3 + 1]; out.position[j * 3 + 2] = P[i * 3 + 2];
    out.birthYear[j] = sk.birthYear[i]; out.order[j] = sk.order[i]; out.strands[j] = sk.strands[i];
    out.radius[j] = sk.radius[i]; out.isMain[j] = sk.isMain[i]; out.isTip[j] = sk.isTip[i]; out.dead[j] = sk.dead[i];
    oldIndex[j] = i;
  }
  return { skeleton: out, oldIndex };
}

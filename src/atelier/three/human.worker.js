// Sculpts heads, hair and hands off the main thread.
import { hairGeometry, handGeometry, headGeometry } from "./human.js";

function pack(geo) {
  const attrs = {};
  const transfer = [];
  for (const [name, attr] of Object.entries(geo.attributes)) {
    const array = attr.array.slice();
    attrs[name] = { array, itemSize: attr.itemSize };
    transfer.push(array.buffer);
  }
  const index = geo.index.array.slice();
  transfer.push(index.buffer);
  return { data: { attrs, index }, transfer };
}

self.onmessage = ({ data: job }) => {
  if (job.kind === "head") {
    const { data, transfer } = pack(headGeometry(job.def, job.quality));
    self.postMessage({ id: job.id, data }, transfer);
  } else if (job.kind === "hair") {
    const { data, transfer } = pack(hairGeometry(job.style, job.quality));
    self.postMessage({ id: job.id, data }, transfer);
  } else if (job.kind === "hand") {
    const { left, right } = handGeometry(job.quality);
    const a = pack(left);
    const b = pack(right);
    self.postMessage({ id: job.id, data: { left: a.data, right: b.data } }, [...a.transfer, ...b.transfer]);
  }
};

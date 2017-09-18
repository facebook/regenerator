const $Symbol = typeof Symbol === "function" ? Symbol : {}
export const iterator = $Symbol.iterator || "@@iterator";
export const asyncIterator = $Symbol.asyncIterator || "@@asyncIterator";
export const toStringTag = $Symbol.toStringTag || "@@toStringTag";

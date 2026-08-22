import { isProxy } from "node:util/types";

type ExactDataRecord<Keys extends readonly string[]> = Readonly<Record<Keys[number], unknown>>;

/**
 * Takes a shallow snapshot of an exact, inert data record.
 *
 * `expectedKeys` is trusted module policy, not caller data. It must be unique;
 * the Promise-assimilation key is rejected. Nested values remain opaque and
 * must be validated or copied synchronously by the domain caller. This function
 * never invokes function-valued properties or assimilates thenables.
 *
 * @internal
 */
export function snapshotExactDataRecord<const Keys extends readonly string[]>(
  candidate: unknown,
  expectedKeys: Keys,
): ExactDataRecord<Keys> | null {
  try {
    if (new Set(expectedKeys).size !== expectedKeys.length || expectedKeys.includes("then")) {
      return null;
    }
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      isProxy(candidate) ||
      Array.isArray(candidate)
    ) {
      return null;
    }

    const prototype = Object.getPrototypeOf(candidate);
    if (prototype !== Object.prototype && prototype !== null) return null;

    const descriptors = Object.getOwnPropertyDescriptors(candidate);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.length !== expectedKeys.length || ownKeys.some((key) => typeof key !== "string")) {
      return null;
    }

    const snapshot = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      if (!Object.hasOwn(descriptors, key)) return null;
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) return null;
      snapshot[key] = descriptor.value;
    }

    return Object.freeze(snapshot) as ExactDataRecord<Keys>;
  } catch {
    return null;
  }
}

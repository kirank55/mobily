export function requireNativeModule<T>(): T {
  throw new Error('Native modules are unavailable in unit tests');
}

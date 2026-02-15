/** Serializers for Set and Map types in useLocalStorage */

export const setSerializer = {
  serialize: (value: Set<string>) => JSON.stringify([...value]),
  deserialize: (value: string) => new Set<string>(JSON.parse(value)),
};

export const mapSerializer = {
  serialize: (value: Map<string, string>) => JSON.stringify([...value.entries()]),
  deserialize: (value: string) => new Map<string, string>(JSON.parse(value)),
};

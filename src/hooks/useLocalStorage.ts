import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Generic hook for managing localStorage state
 */
export function useLocalStorage<T>(
  key: string,
  defaultValue: T,
  serializer?: {
    serialize: (value: T) => string;
    deserialize: (value: string) => T;
  }
) {
  // Store serializer in ref to avoid recreating on every render
  const serializerRef = useRef(serializer);
  serializerRef.current = serializer;

  const serialize = useCallback((value: T) => {
    return serializerRef.current?.serialize?.(value) ?? JSON.stringify(value);
  }, []);

  const deserialize = useCallback((value: string) => {
    return serializerRef.current?.deserialize?.(value) ?? JSON.parse(value);
  }, []);

  const [state, setState] = useState<T>(() => {
    try {
      const item = localStorage.getItem(key);
      return item ? deserialize(item) : defaultValue;
    } catch (error) {
      console.warn(`Failed to load ${key} from localStorage:`, error);
      return defaultValue;
    }
  });

  const setValue = useCallback((value: T | ((prev: T) => T)) => {
    setState(prev => {
      try {
        const valueToStore = value instanceof Function ? value(prev) : value;
        localStorage.setItem(key, serialize(valueToStore));
        return valueToStore;
      } catch (error) {
        console.warn(`Failed to save ${key} to localStorage:`, error);
        return prev;
      }
    });
  }, [key, serialize]);

  // Sync with localStorage changes from other tabs
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === key && e.newValue !== null) {
        try {
          setState(deserialize(e.newValue));
        } catch (error) {
          console.warn(`Failed to sync ${key} from localStorage:`, error);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [key, deserialize]);

  return [state, setValue] as const;
}
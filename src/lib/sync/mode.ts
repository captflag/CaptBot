import { useSyncExternalStore } from 'react';
import { embeddingKeyOf, useSettings, type Settings } from '../settings';

export interface StorageMode {
  /** The account's knowledge base lives on the server and syncs; otherwise only this browser has it. */
  server: boolean;
  /** The vector space server storage indexes with, e.g. "server:gemini-embedding-2:768". */
  embeddingKey: string | null;
}

let mode: StorageMode = { server: false, embeddingKey: null };
const listeners = new Set<() => void>();

export const getStorageMode = (): StorageMode => mode;
export const isServerStorage = (): boolean => mode.server;

export function setStorageMode(next: StorageMode) {
  mode = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStorageMode(): StorageMode {
  return useSyncExternalStore(subscribe, getStorageMode);
}

/** The vector space new documents are indexed in: the server's in server storage, otherwise the configured model's. */
export function activeEmbeddingKey(settings: Settings): string {
  return mode.server ? (mode.embeddingKey ?? '') : embeddingKeyOf(settings);
}

export function useActiveEmbeddingKey(): string {
  const settings = useSettings();
  const storage = useStorageMode();
  return storage.server ? (storage.embeddingKey ?? '') : embeddingKeyOf(settings);
}

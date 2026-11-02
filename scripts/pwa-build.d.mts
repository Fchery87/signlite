import type { Plugin } from 'vite';
export interface PrecacheManifest { version: string; urls: string[] }
export function createPrecacheManifest(files: Map<string, string | Uint8Array>): PrecacheManifest;
export function renderServiceWorker(manifest: PrecacheManifest): string;
export function pwaBuild(): Plugin;

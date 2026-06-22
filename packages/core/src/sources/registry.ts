import type { MusicSource } from "./types";

export class SourceRegistry {
  private readonly map = new Map<string, MusicSource>();

  register(source: MusicSource): void {
    if (this.map.has(source.id)) {
      throw new Error(`MusicSource ${source.id} is already registered`);
    }
    this.map.set(source.id, source);
  }

  unregister(id: string): void {
    this.map.delete(id);
  }

  get(id: string): MusicSource | undefined {
    return this.map.get(id);
  }

  list(): MusicSource[] {
    return Array.from(this.map.values());
  }

  has(id: string): boolean {
    return this.map.has(id);
  }
}

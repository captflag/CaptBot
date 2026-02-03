
export class CacheService {
  private cache: Map<string, any> = new Map();
  private readonly MAX_SIZE = 50;

  private normalize(query: string): string {
    return query.trim().toLowerCase().replace(/[?.,!]/g, '');
  }

  get(query: string): any | null {
    const key = this.normalize(query);
    return this.cache.get(key) || null;
  }

  set(query: string, response: any): void {
    const key = this.normalize(query);
    if (this.cache.size >= this.MAX_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, response);
  }

  clear(): void {
    this.cache.clear();
  }
}

export const neuralCache = new CacheService();

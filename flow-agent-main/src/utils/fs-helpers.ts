import fs from 'fs';
import path from 'path';

export class FsHelpers {
  public static ensureDirSync(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  public static async ensureDir(dirPath: string): Promise<void> {
    await fs.promises.mkdir(dirPath, { recursive: true });
  }

  public static async writeJsonFile(filePath: string, data: any): Promise<void> {
    await this.ensureDir(path.dirname(filePath));
    const content = JSON.stringify(data, null, 2);
    await fs.promises.writeFile(filePath, content, 'utf-8');
  }

  public static async readJsonFile<T = any>(filePath: string): Promise<T | null> {
    try {
      if (!fs.existsSync(filePath)) return null;
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }

  public static fileExists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }

  public static async getFileSize(filePath: string): Promise<number> {
    try {
      const stats = await fs.promises.stat(filePath);
      return stats.size;
    } catch {
      return 0;
    }
  }
}

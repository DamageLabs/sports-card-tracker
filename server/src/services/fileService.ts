import fs from 'fs';
import path from 'path';
import { FileInfo, LogEntry } from '../types';

class FileService {
  private rawDir: string;
  private processedDir: string;
  private dataDir: string;

  constructor(rawDir: string, processedDir: string, dataDir: string) {
    this.rawDir = rawDir;
    this.processedDir = processedDir;
    this.dataDir = dataDir;
  }

  ensureDirectories(): void {
    for (const dir of [this.rawDir, this.processedDir, this.getExportsDir()]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  directoriesExist(): boolean {
    return fs.existsSync(this.rawDir) && fs.existsSync(this.processedDir);
  }

  listFiles(dir: string): FileInfo[] {
    const safePath = this.getSafePath(dir);
    if (!fs.existsSync(safePath)) return [];

    return fs.readdirSync(safePath)
      .filter(name => !name.startsWith('.'))
      .map(name => {
        const filePath = path.join(safePath, name);
        const stat = fs.statSync(filePath);
        return {
          name,
          size: stat.size,
          modified: stat.mtime.toISOString(),
          type: path.extname(name).slice(1).toLowerCase(),
        };
      })
      .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
  }

  getFilePath(dir: string, filename: string): string | null {
    const safeName = path.basename(filename);
    const fullPath = path.join(dir, safeName);
    const resolved = path.resolve(fullPath);

    if (!resolved.startsWith(path.resolve(dir))) {
      return null;
    }
    return resolved;
  }

  fileExists(dir: string, filename: string): boolean {
    const filePath = this.getFilePath(dir, filename);
    if (!filePath) return false;
    return fs.existsSync(filePath);
  }

  deleteFile(dir: string, filename: string): boolean {
    const filePath = this.getFilePath(dir, filename);
    if (!filePath || !fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  }

  copyFile(srcDir: string, srcFilename: string, destDir: string, destFilename: string): boolean {
    const srcPath = this.getFilePath(srcDir, srcFilename);
    const destPath = this.getFilePath(destDir, destFilename);
    if (!srcPath || !destPath) return false;
    if (!fs.existsSync(srcPath)) return false;
    fs.copyFileSync(srcPath, destPath);
    return true;
  }

  readLog(logName: string): LogEntry[] {
    const logPath = path.join(this.dataDir, logName);
    if (!fs.existsSync(logPath)) return [];

    const content = fs.readFileSync(logPath, 'utf-8').trim();
    if (!content) return [];

    return content.split('\n').map(line => {
      const match = line.match(/^\[(.+?)\]\s+(.+?):\s+(.+)$/);
      if (!match) return { timestamp: '', filename: '', reason: line };
      return {
        timestamp: match[1],
        filename: match[2],
        reason: match[3],
      };
    });
  }

  appendLog(logName: string, entry: LogEntry): void {
    const logPath = path.join(this.dataDir, logName);
    const line = `[${entry.timestamp}] ${entry.filename}: ${entry.reason}\n`;
    fs.appendFileSync(logPath, line);
  }

  clearLog(logName: string): void {
    const logPath = path.join(this.dataDir, logName);
    if (fs.existsSync(logPath)) {
      fs.writeFileSync(logPath, '');
    }
  }

  getRawDir(): string {
    return this.rawDir;
  }

  getProcessedDir(): string {
    return this.processedDir;
  }

  getDataDir(): string {
    return this.dataDir;
  }

  getExportsDir(): string {
    const exportsDir = path.join(this.dataDir, 'exports');
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir, { recursive: true });
    }
    return exportsDir;
  }

  /** Grade-analysis evidence crops (defect close-ups). Kept out of processed/
   *  so gallery listings and card-image lookups never see them. */
  getAnalysisDir(): string {
    const analysisDir = path.join(this.dataDir, 'analysis');
    if (!fs.existsSync(analysisDir)) {
      fs.mkdirSync(analysisDir, { recursive: true });
    }
    return analysisDir;
  }

  private getSafePath(dir: string): string {
    const resolved = path.resolve(dir);
    return resolved;
  }
}

export default FileService;

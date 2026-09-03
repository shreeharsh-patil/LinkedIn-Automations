import EventEmitter from 'events';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'success';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  projectId?: string;
  context?: any;
}

class LoggerService extends EventEmitter {
  private logs: LogEntry[] = [];
  private maxLogs = 5000;

  private formatMessage(level: LogLevel, message: string, projectId?: string): string {
    const timeStr = new Date().toISOString().substring(11, 19);
    const prefix = projectId ? `[${projectId}]` : '';
    return `[${timeStr}] [${level.toUpperCase()}] ${prefix} ${message}`;
  }

  public log(level: LogLevel, message: string, projectId?: string, context?: any) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      projectId,
      context,
    };

    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    const formatted = this.formatMessage(level, message, projectId);
    switch (level) {
      case 'error':
        console.error('\x1b[31m%s\x1b[0m', formatted);
        break;
      case 'warn':
        console.warn('\x1b[33m%s\x1b[0m', formatted);
        break;
      case 'success':
        console.log('\x1b[32m%s\x1b[0m', formatted);
        break;
      case 'debug':
        console.debug('\x1b[36m%s\x1b[0m', formatted);
        break;
      default:
        console.log('\x1b[37m%s\x1b[0m', formatted);
        break;
    }

    this.emit('log', entry);
  }

  public info(message: string, projectId?: string, context?: any) {
    this.log('info', message, projectId, context);
  }

  public warn(message: string, projectId?: string, context?: any) {
    this.log('warn', message, projectId, context);
  }

  public error(message: string, projectId?: string, context?: any) {
    this.log('error', message, projectId, context);
  }

  public success(message: string, projectId?: string, context?: any) {
    this.log('success', message, projectId, context);
  }

  public debug(message: string, projectId?: string, context?: any) {
    this.log('debug', message, projectId, context);
  }

  public getLogs(projectId?: string): LogEntry[] {
    if (projectId) {
      return this.logs.filter((l) => l.projectId === projectId);
    }
    return this.logs;
  }
}

export const logger = new LoggerService();

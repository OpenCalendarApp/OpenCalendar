import type { UserRole } from '@session-scheduler/shared';

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: number;
        email: string;
        role: UserRole;
      };
      requestId?: string;
    }
  }
}

export {};

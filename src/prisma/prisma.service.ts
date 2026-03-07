import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'info' },
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'error' },
      ],
      errorFormat: 'colorless',
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Database connection closed');
  }

  /**
   * Executes a callback inside a short transaction with the current user's ID
   * set as a transaction-local PostgreSQL config variable (`app.current_user_id`).
   *
   * RLS policies on `ai_chat_sessions`, `ai_messages`, `students`, and
   * `conversations` enforce row-level isolation when this context is active.
   * When context is NOT set (admin ops, writes, seed scripts), the policies
   * allow all rows through — no regressions on existing code.
   *
   * Usage:
   *   const sessions = await this.prisma.withUserContext(userId, (tx) =>
   *     tx.ai_chat_sessions.findMany({ where: { userId } })
   *   );
   */
  async withUserContext<T>(
    userId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
      return fn(tx);
    });
  }

  async cleanDatabase() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('cleanDatabase is not allowed in production');
    }

    const models = Reflect.ownKeys(this).filter(
      key => typeof key === 'string' && !key.startsWith('_') && !key.startsWith('$'),
    );

    return Promise.all(
      models.map(modelKey => {
        const model = this[modelKey as keyof this];
        if (model && typeof model === 'object' && 'deleteMany' in model) {
          return (model as { deleteMany: () => Promise<unknown> }).deleteMany();
        }
        return Promise.resolve();
      }),
    );
  }
}


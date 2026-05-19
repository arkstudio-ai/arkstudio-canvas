import {
  Module,
  Global,
  type DynamicModule,
  type Provider,
  type Type,
  type FactoryProvider,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Default-path config: `imports: [PrismaModule]` —— @Module decorator 上
 * 写好的 PrismaService 直接使用，OSS 自部署 / docker / Electron 都走这条。
 *
 * Fork / 下游产品扩展路径: `PrismaModule.forRoot({ useExisting: ... })`。
 * 见 forRoot 方法注释。
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {
  /**
   * Replace the bound PrismaService with a custom implementation. Intended
   * for downstream forks that need PrismaService backed by a different
   * Prisma schema / generated client (e.g. commercial multi-tenant builds
   * pointing at per-tenant Postgres, or a vertical edition with schema
   * extensions appended).
   *
   * The replacement must remain structurally compatible with the default
   * `PrismaService` (extends `PrismaClient`, implements `OnModuleInit /
   * OnModuleDestroy`) so downstream modules wiring `@Inject(PrismaService)`
   * continue to compile and work.
   *
   * Accepts any standard Nest provider shape (`useClass` / `useExisting` /
   * `useFactory`). OSS deployments do not need to call this — keep using
   * `imports: [PrismaModule]`.
   */
  static forRoot(options: PrismaForRootOptions): DynamicModule {
    let provider: Provider;
    if ('useExisting' in options && options.useExisting) {
      provider = { provide: PrismaService, useExisting: options.useExisting };
    } else if ('useClass' in options && options.useClass) {
      provider = { provide: PrismaService, useClass: options.useClass };
    } else if ('useFactory' in options && options.useFactory) {
      provider = {
        provide: PrismaService,
        useFactory: options.useFactory,
        inject: options.inject ?? [],
      } satisfies FactoryProvider;
    } else {
      provider = PrismaService;
    }
    return {
      module: PrismaModule,
      global: true,
      providers: [provider],
      exports: [PrismaService],
    };
  }
}

export type PrismaForRootOptions =
  | { useExisting: Type<unknown>; useClass?: never; useFactory?: never; inject?: never }
  | { useClass: Type<unknown>; useExisting?: never; useFactory?: never; inject?: never }
  | {
      useFactory: (...args: unknown[]) => unknown | Promise<unknown>;
      inject?: FactoryProvider['inject'];
      useClass?: never;
      useExisting?: never;
    };

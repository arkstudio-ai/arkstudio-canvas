// 必须放在第一行: 在 AppModule (会解析 PrismaModule) 之前给 process.env
// 兜个默认 DATABASE_URL, 否则 Prisma onModuleInit 会以 P1012 直接挂掉.
import './bootstrap-env';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
      whitelist: true,
      skipMissingProperties: false,
      forbidNonWhitelisted: false,
    }),
  );

  const port = process.env.PORT ?? 18500;
  await app.listen(port);

  console.log(`Server running on port ${port}`);
}
bootstrap();

import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Query,
} from '@nestjs/common';
import { GenerationHistoryService } from './generation-history.service';
import { QueryHistoryDto } from './dto/query-history.dto';

@Controller('generation-history')
export class GenerationHistoryController {
  constructor(private readonly service: GenerationHistoryService) {}

  @Get()
  query(@Query() dto: QueryHistoryDto) {
    return this.service.query(dto);
  }

  @Get(':id/instantiate')
  instantiate(@Param('id') id: string) {
    return this.service.instantiate(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

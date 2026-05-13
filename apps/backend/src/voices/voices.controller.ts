import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { VoicesService } from './voices.service';
import { CloneVoiceDto } from './dto/clone-voice.dto';
import { QueryVoicesDto } from './dto/query-voices.dto';

@Controller('voices')
export class VoicesController {
  constructor(private readonly voicesService: VoicesService) {}

  @Get()
  list(@Query() query: QueryVoicesDto) {
    return this.voicesService.list(query);
  }

  @Post('clone')
  @HttpCode(HttpStatus.OK)
  clone(@Body() dto: CloneVoiceDto) {
    return this.voicesService.clone(dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.voicesService.remove(id);
  }
}

import { Controller, Get, Post, Patch, Body, Param, Delete, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { QueryTemplateDto } from './dto/query-template.dto';

@Controller('templates')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get('tags')
  getTags(@Query('category') category?: string) {
    return this.templatesService.getTags(category);
  }

  @Post()
  create(@Body() createDto: CreateTemplateDto) {
    return this.templatesService.create(createDto);
  }

  @Post('query')
  @HttpCode(HttpStatus.OK)
  query(@Body() queryDto: QueryTemplateDto) {
    return this.templatesService.query(queryDto);
  }

  @Post(':id/instantiate')
  @HttpCode(HttpStatus.OK)
  instantiate(@Param('id') id: string) {
    return this.templatesService.instantiate(id);
  }

  @Get()
  findAll() {
    return this.templatesService.query({ page: 1, limit: 100 });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.templatesService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDto: UpdateTemplateDto) {
    return this.templatesService.update(id, updateDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.templatesService.remove(id);
  }
}

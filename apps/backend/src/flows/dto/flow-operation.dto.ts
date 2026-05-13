import { IsString, IsOptional, IsObject, IsNotEmpty, IsArray, ValidateNested, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class FlowOperationDto {
  @IsString()
  @IsNotEmpty()
  op: string;

  @IsObject()
  @IsNotEmpty()
  data: any;
}

export class BatchOperationDto {
  @IsNumber()
  version: number; // 乐观锁版本号

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FlowOperationDto)
  operations: FlowOperationDto[];
}





































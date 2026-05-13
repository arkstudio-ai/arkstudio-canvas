import { IsString, IsNotEmpty, IsNumber, Max, IsOptional } from 'class-validator';

export class GetUploadSignDto {
  @IsString()
  @IsNotEmpty({ message: 'fileName 不能为空' })
  fileName: string;

  @IsString()
  @IsOptional()
  fileType?: string;

  @IsNumber()
  @Max(524288000, { message: '文件大小不能超过 500MB' })
  fileSize: number;
}














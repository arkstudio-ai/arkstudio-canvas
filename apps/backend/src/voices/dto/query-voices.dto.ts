import { IsIn, IsOptional, IsString } from 'class-validator';

export class QueryVoicesDto {
  /** 仅返回某个状态。不传 = 全部。 */
  @IsOptional()
  @IsString()
  @IsIn(['SUCCESS', 'FAILED'])
  status?: 'SUCCESS' | 'FAILED';
}

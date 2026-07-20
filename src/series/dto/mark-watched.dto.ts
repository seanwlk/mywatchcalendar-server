import { IsOptional, IsDateString } from 'class-validator';

export class MarkWatchedDto {
  @IsOptional()
  @IsDateString()
  watchedAt?: string;
}
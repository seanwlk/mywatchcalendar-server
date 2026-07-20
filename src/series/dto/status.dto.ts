import { IsEnum, IsOptional } from 'class-validator';

export enum SeriesStatusDto {
  WATCHING = 'WATCHING',
  DROPPED = 'DROPPED',
  COMPLETED = 'COMPLETED',
}

export class UpdateSeriesStatusDto {
  @IsEnum(SeriesStatusDto)
  status: SeriesStatusDto = SeriesStatusDto.WATCHING;
}
